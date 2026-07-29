'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../utils/http');
const { requireAuth } = require('../middleware/auth');
const { isPrivileged } = require('../utils/rbac');
const dates = require('../utils/dates');

const router = express.Router();
router.use(requireAuth);

/** بطاقات لوحة التحكم — تختلف باختلاف دور المستخدم. */
router.get('/', asyncHandler(async (req, res) => {
  const today = dates.today();
  const user = req.user;

  const personal = {
    attendance_today: db.get(
      'SELECT * FROM attendance WHERE employee_id = ? AND date = ?', [user.id, today],
    ) || null,
    pending_leaves: db.get(
      "SELECT COUNT(*) AS n FROM leaves WHERE employee_id = ? AND status = 'pending'", [user.id],
    ).n,
    pending_requests: db.get(
      "SELECT COUNT(*) AS n FROM service_requests WHERE employee_id = ? AND status = 'pending'", [user.id],
    ).n,
    unread_notifications: db.get(
      'SELECT COUNT(*) AS n FROM notifications WHERE employee_id = ? AND is_read = 0', [user.id],
    ).n,
    my_trips: db.get(
      "SELECT COUNT(*) AS n FROM trips WHERE driver_id = ? AND status IN ('planned','in_progress')", [user.id],
    ).n,
  };

  const balance = (() => {
    const employee = db.get('SELECT annual_leave_balance FROM employees WHERE id = ?', [user.id]);
    const used = db.get(
      `SELECT COALESCE(SUM(l.days), 0) AS days
         FROM leaves l JOIN leave_types t ON t.id = l.leave_type_id
        WHERE l.employee_id = ? AND l.status = 'approved' AND t.deducts_balance = 1
          AND l.start_date LIKE ?`,
      [user.id, `${today.slice(0, 4)}-%`],
    ).days;
    return {
      entitlement: employee.annual_leave_balance || 0,
      used,
      remaining: Math.max(0, (employee.annual_leave_balance || 0) - used),
    };
  })();

  const monthlySummary = (() => {
    const now = new Date();
    const { from, to } = dates.monthRange(now.getFullYear(), now.getMonth() + 1);
    return db.get(
      `SELECT COALESCE(SUM(CASE WHEN status IN ('present','remote','mission') THEN 1 ELSE 0 END), 0) AS present_days,
              COALESCE(SUM(CASE WHEN status = 'late'   THEN 1 ELSE 0 END), 0) AS late_days,
              COALESCE(SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END), 0) AS absent_days,
              COALESCE(SUM(work_minutes), 0) AS work_minutes
         FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ?`,
      [user.id, from, to],
    );
  })();

  const payload = {
    personal,
    leave_balance: balance,
    month_attendance: monthlySummary,
    announcements: db.all(
      `SELECT a.id, a.title, a.priority, a.published_at, a.pinned, e.full_name_ar AS author_name
         FROM announcements a LEFT JOIN employees e ON e.id = a.published_by
        WHERE (a.department_id IS NULL OR a.department_id = ?)
          AND (a.expires_at IS NULL OR a.expires_at >= date('now'))
        ORDER BY a.pinned DESC, a.published_at DESC LIMIT 5`,
      [user.department_id || -1],
    ),
    my_upcoming_leaves: db.all(
      `SELECT l.id, l.start_date, l.end_date, l.days, l.status, t.name_ar AS leave_type_name
         FROM leaves l JOIN leave_types t ON t.id = l.leave_type_id
        WHERE l.employee_id = ? AND l.end_date >= date('now')
          AND l.status IN ('pending','approved')
        ORDER BY l.start_date LIMIT 5`,
      [user.id],
    ),
  };

  // بطاقات إدارية إضافية
  if (isPrivileged(user.role) || user.role === 'operations') {
    payload.company = {
      total_employees: db.get("SELECT COUNT(*) AS n FROM employees WHERE status = 'active'").n,
      departments: db.get('SELECT COUNT(*) AS n FROM departments').n,
      present_today: db.get(
        `SELECT COUNT(*) AS n FROM attendance
          WHERE date = ? AND status IN ('present','late','remote','mission')`, [today],
      ).n,
      absent_today: db.get(
        "SELECT COUNT(*) AS n FROM attendance WHERE date = ? AND status = 'absent'", [today],
      ).n,
      on_leave_today: db.get(
        `SELECT COUNT(*) AS n FROM leaves
          WHERE status = 'approved' AND ? BETWEEN start_date AND end_date`, [today],
      ).n,
      pending_leaves: db.get("SELECT COUNT(*) AS n FROM leaves WHERE status = 'pending'").n,
      pending_requests: db.get("SELECT COUNT(*) AS n FROM service_requests WHERE status = 'pending'").n,
      new_hires_30d: db.get(
        "SELECT COUNT(*) AS n FROM employees WHERE hire_date >= date('now','-30 days')",
      ).n,
    };

    payload.headcount_by_department = db.all(
      `SELECT d.name_ar AS label, COUNT(e.id) AS value
         FROM departments d
         LEFT JOIN employees e ON e.department_id = d.id AND e.status = 'active'
        GROUP BY d.id ORDER BY value DESC`,
    );

    payload.attendance_trend = db.all(
      `SELECT date AS label,
              SUM(CASE WHEN status IN ('present','remote','mission') THEN 1 ELSE 0 END) AS present,
              SUM(CASE WHEN status = 'late'   THEN 1 ELSE 0 END) AS late,
              SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS absent
         FROM attendance
        WHERE date >= date('now','-13 days')
        GROUP BY date ORDER BY date`,
    );
  }

  if (['admin', 'operations', 'manager'].includes(user.role)) {
    payload.fleet = {
      total: db.get('SELECT COUNT(*) AS n FROM vehicles').n,
      available: db.get("SELECT COUNT(*) AS n FROM vehicles WHERE status = 'available'").n,
      on_trip: db.get("SELECT COUNT(*) AS n FROM vehicles WHERE status = 'on_trip'").n,
      maintenance: db.get("SELECT COUNT(*) AS n FROM vehicles WHERE status = 'maintenance'").n,
      trips_in_progress: db.get("SELECT COUNT(*) AS n FROM trips WHERE status = 'in_progress'").n,
      trips_planned: db.get("SELECT COUNT(*) AS n FROM trips WHERE status = 'planned'").n,
      trips_completed_30d: db.get(
        "SELECT COUNT(*) AS n FROM trips WHERE status = 'completed' AND date(created_at) >= date('now','-30 days')",
      ).n,
      alerts: db.all(
        `SELECT plate_no, insurance_expiry, registration_expiry, next_maintenance
           FROM vehicles
          WHERE (insurance_expiry    IS NOT NULL AND insurance_expiry    <= date('now','+30 days'))
             OR (registration_expiry IS NOT NULL AND registration_expiry <= date('now','+30 days'))
             OR (next_maintenance    IS NOT NULL AND next_maintenance    <= date('now','+30 days'))
          LIMIT 10`,
      ),
    };
  }

  if (['admin', 'hr', 'manager'].includes(user.role)) {
    payload.approvals = db.all(
      `SELECT l.id, l.start_date, l.end_date, l.days, e.full_name_ar AS employee_name,
              t.name_ar AS leave_type_name
         FROM leaves l
         JOIN employees   e ON e.id = l.employee_id
         JOIN leave_types t ON t.id = l.leave_type_id
        WHERE l.status = 'pending'
          AND (? IN ('admin','hr') OR e.manager_id = ?)
        ORDER BY l.created_at LIMIT 10`,
      [user.role, user.id],
    );
  }

  if (['admin', 'hr'].includes(user.role)) {
    payload.expiring_documents = db.all(
      `SELECT id, full_name_ar, iqama_expiry, license_expiry
         FROM employees
        WHERE status = 'active'
          AND ((iqama_expiry   IS NOT NULL AND iqama_expiry   <= date('now','+60 days'))
            OR (license_expiry IS NOT NULL AND license_expiry <= date('now','+60 days')))
        ORDER BY COALESCE(iqama_expiry, license_expiry) LIMIT 10`,
    );
  }

  res.json({ data: payload });
}));

module.exports = router;
