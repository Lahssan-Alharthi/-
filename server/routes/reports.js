'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler, badRequest } = require('../utils/http');
const { requireAuth, requirePermission } = require('../middleware/auth');
const dates = require('../utils/dates');

const router = express.Router();
router.use(requireAuth, requirePermission('reports:read'));

/** يحوّل صفوفاً إلى CSV مع BOM ليُفتح بترميز صحيح في Excel العربي. */
function toCsv(rows) {
  if (!rows.length) return '﻿';
  const headers = Object.keys(rows[0]);
  const escape = (value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [headers.join(','), ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))];
  return `﻿${lines.join('\n')}`;
}

function sendResult(req, res, rows, filename) {
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    return res.send(toCsv(rows));
  }
  return res.json({ data: rows });
}

// تقرير الحضور الشهري لكل الموظفين
router.get('/attendance', asyncHandler(async (req, res) => {
  const now = new Date();
  const year = Number(req.query.year) || now.getFullYear();
  const month = Number(req.query.month) || now.getMonth() + 1;
  if (month < 1 || month > 12) throw badRequest('الشهر غير صالح');

  const { from, to } = dates.monthRange(year, month);
  const rows = db.all(
    `SELECT e.employee_no AS "الرقم الوظيفي",
            e.full_name_ar AS "الاسم",
            d.name_ar AS "القسم",
            COUNT(a.id) AS "أيام مسجلة",
            SUM(CASE WHEN a.status IN ('present','remote','mission') THEN 1 ELSE 0 END) AS "أيام حضور",
            SUM(CASE WHEN a.status = 'late'   THEN 1 ELSE 0 END) AS "أيام تأخير",
            SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS "أيام غياب",
            SUM(CASE WHEN a.status = 'leave'  THEN 1 ELSE 0 END) AS "أيام إجازة",
            COALESCE(SUM(a.late_minutes), 0) AS "دقائق التأخير",
            ROUND(COALESCE(SUM(a.work_minutes), 0) / 60.0, 1) AS "ساعات العمل",
            ROUND(COALESCE(SUM(a.overtime_minutes), 0) / 60.0, 1) AS "ساعات إضافية"
       FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN attendance  a ON a.employee_id = e.id AND a.date BETWEEN ? AND ?
      WHERE e.status = 'active'
      GROUP BY e.id ORDER BY e.full_name_ar`,
    [from, to],
  );

  sendResult(req, res, rows, `attendance-${year}-${month}`);
}));

// تقرير الإجازات
router.get('/leaves', asyncHandler(async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const rows = db.all(
    `SELECT e.employee_no AS "الرقم الوظيفي",
            e.full_name_ar AS "الاسم",
            d.name_ar AS "القسم",
            t.name_ar AS "نوع الإجازة",
            l.start_date AS "من",
            l.end_date AS "إلى",
            l.days AS "عدد الأيام",
            CASE l.status WHEN 'approved' THEN 'معتمدة' WHEN 'pending' THEN 'قيد الاعتماد'
                          WHEN 'rejected' THEN 'مرفوضة' ELSE 'ملغاة' END AS "الحالة",
            a.full_name_ar AS "المعتمد"
       FROM leaves l
       JOIN employees   e ON e.id = l.employee_id
       JOIN leave_types t ON t.id = l.leave_type_id
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN employees   a ON a.id = l.approver_id
      WHERE l.start_date LIKE ?
      ORDER BY l.start_date DESC`,
    [`${year}-%`],
  );

  sendResult(req, res, rows, `leaves-${year}`);
}));

// تقرير القوى العاملة
router.get('/headcount', asyncHandler(async (req, res) => {
  const rows = db.all(
    `SELECT d.name_ar AS "القسم",
            COUNT(e.id) AS "عدد الموظفين",
            SUM(CASE WHEN e.gender = 'ذكر' THEN 1 ELSE 0 END) AS "ذكور",
            SUM(CASE WHEN e.gender = 'أنثى' THEN 1 ELSE 0 END) AS "إناث",
            SUM(CASE WHEN e.contract_type = 'دوام كامل' THEN 1 ELSE 0 END) AS "دوام كامل",
            SUM(CASE WHEN e.hire_date >= date('now','-90 days') THEN 1 ELSE 0 END) AS "تعيينات حديثة"
       FROM departments d
       LEFT JOIN employees e ON e.department_id = d.id AND e.status = 'active'
      GROUP BY d.id ORDER BY "عدد الموظفين" DESC`,
  );

  sendResult(req, res, rows, 'headcount');
}));

// تقرير تكلفة الرواتب
router.get('/payroll-cost', requirePermission('payroll:read'), asyncHandler(async (req, res) => {
  const rows = db.all(
    `SELECT r.year AS "السنة",
            r.month AS "الشهر",
            COUNT(p.id) AS "عدد الموظفين",
            SUM(CASE WHEN p.gosi_category = 'saudi' THEN 1 ELSE 0 END) AS "سعوديون",
            SUM(CASE WHEN p.gosi_category <> 'saudi' THEN 1 ELSE 0 END) AS "غير سعوديين",
            ROUND(SUM(p.gross_amount), 2) AS "إجمالي الاستحقاق",
            ROUND(SUM(p.gosi_deduction), 2) AS "تأمينات حصة الموظف",
            ROUND(SUM(p.gosi_deduction + p.absence_deduction + p.loan_deduction + p.other_deduction), 2) AS "إجمالي الاستقطاعات",
            ROUND(SUM(p.net_amount), 2) AS "صافي المستحق",
            ROUND(SUM(p.gosi_employer), 2) AS "تأمينات حصة صاحب العمل",
            ROUND(SUM(p.gross_amount + p.gosi_employer), 2) AS "تكلفة الشركة الإجمالية",
            CASE r.status WHEN 'approved' THEN 'معتمد' ELSE 'مسودة' END AS "الحالة"
       FROM payroll_runs r LEFT JOIN payslips p ON p.run_id = r.id
      GROUP BY r.id ORDER BY r.year DESC, r.month DESC`,
  );

  sendResult(req, res, rows, 'payroll-cost');
}));

// تقرير عمليات النقل
router.get('/trips', asyncHandler(async (req, res) => {
  const from = req.query.from || dates.addDays(dates.today(), -30);
  const to = req.query.to || dates.today();

  const rows = db.all(
    `SELECT t.code AS "رمز الرحلة",
            t.client_name AS "العميل",
            t.origin AS "من",
            t.destination AS "إلى",
            v.plate_no AS "المركبة",
            e.full_name_ar AS "السائق",
            t.weight_kg AS "الوزن (كجم)",
            t.distance_km AS "المسافة (كم)",
            t.cost AS "التكلفة",
            t.depart_at AS "موعد الانطلاق",
            CASE t.status WHEN 'completed' THEN 'مكتملة' WHEN 'in_progress' THEN 'جارية'
                          WHEN 'planned' THEN 'مخططة' WHEN 'delayed' THEN 'متأخرة'
                          ELSE 'ملغاة' END AS "الحالة"
       FROM trips t
       LEFT JOIN vehicles  v ON v.id = t.vehicle_id
       LEFT JOIN employees e ON e.id = t.driver_id
      WHERE date(COALESCE(t.depart_at, t.created_at)) BETWEEN ? AND ?
      ORDER BY t.depart_at DESC`,
    [from, to],
  );

  sendResult(req, res, rows, `trips-${from}_${to}`);
}));

// ملخّص رقمي للرسوم البيانية
router.get('/summary', asyncHandler(async (req, res) => {
  res.json({
    data: {
      leaves_by_type: db.all(
        `SELECT t.name_ar AS label, COUNT(l.id) AS value
           FROM leave_types t LEFT JOIN leaves l ON l.leave_type_id = t.id AND l.status = 'approved'
          GROUP BY t.id ORDER BY value DESC`,
      ),
      trips_by_status: db.all(
        'SELECT status AS label, COUNT(*) AS value FROM trips GROUP BY status',
      ),
      monthly_trips: db.all(
        `SELECT strftime('%Y-%m', COALESCE(depart_at, created_at)) AS label, COUNT(*) AS value
           FROM trips GROUP BY label ORDER BY label DESC LIMIT 12`,
      ),
      top_destinations: db.all(
        `SELECT destination AS label, COUNT(*) AS value
           FROM trips GROUP BY destination ORDER BY value DESC LIMIT 8`,
      ),
    },
  });
}));

module.exports = router;
