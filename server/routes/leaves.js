'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler, badRequest, notFound, forbidden, conflict } = require('../utils/http');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { isPrivileged } = require('../utils/rbac');
const dates = require('../utils/dates');
const audit = require('../utils/audit');
const notify = require('../utils/notify');
const hooks = require('../utils/webhooks');

const router = express.Router();
router.use(requireAuth);

const SELECT_BASE = `
  SELECT l.*, e.full_name_ar AS employee_name, e.employee_no, e.manager_id,
         d.name_ar AS department_name,
         t.name_ar AS leave_type_name, t.code AS leave_type_code,
         t.deducts_balance, t.paid,
         a.full_name_ar AS approver_name
    FROM leaves l
    JOIN employees   e ON e.id = l.employee_id
    JOIN leave_types t ON t.id = l.leave_type_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN employees   a ON a.id = l.approver_id`;

/** من يحق له البتّ في الطلب: المدير المباشر أو الموارد البشرية أو مدير النظام. */
function canDecide(user, leave) {
  if (['admin', 'hr'].includes(user.role)) return true;
  return user.role === 'manager' && leave.manager_id === user.id;
}

// أنواع الإجازات
router.get('/types', asyncHandler(async (req, res) => {
  res.json({ data: db.all('SELECT * FROM leave_types ORDER BY id') });
}));

// رصيد الإجازات
router.get('/balance/:employeeId?', asyncHandler(async (req, res) => {
  const employeeId = req.params.employeeId ? Number(req.params.employeeId) : req.user.id;
  if (employeeId !== req.user.id && !isPrivileged(req.user.role)) throw forbidden();

  const employee = db.get('SELECT annual_leave_balance, hire_date FROM employees WHERE id = ?', [employeeId]);
  if (!employee) throw notFound('الموظف غير موجود');

  const year = Number(req.query.year) || new Date().getFullYear();
  const used = db.get(
    `SELECT COALESCE(SUM(l.days), 0) AS days
       FROM leaves l JOIN leave_types t ON t.id = l.leave_type_id
      WHERE l.employee_id = ? AND l.status = 'approved'
        AND t.deducts_balance = 1 AND l.start_date LIKE ?`,
    [employeeId, `${year}-%`],
  ).days;

  const pending = db.get(
    `SELECT COALESCE(SUM(l.days), 0) AS days
       FROM leaves l JOIN leave_types t ON t.id = l.leave_type_id
      WHERE l.employee_id = ? AND l.status = 'pending'
        AND t.deducts_balance = 1 AND l.start_date LIKE ?`,
    [employeeId, `${year}-%`],
  ).days;

  const entitlement = employee.annual_leave_balance || 0;
  res.json({
    data: {
      year,
      entitlement,
      used,
      pending,
      remaining: Math.max(0, entitlement - used - pending),
    },
  });
}));

// قائمة الطلبات
router.get('/', asyncHandler(async (req, res) => {
  const where = [];
  const params = [];

  const scope = req.query.scope || (isPrivileged(req.user.role) ? 'all' : 'mine');

  if (scope === 'mine' || !isPrivileged(req.user.role)) {
    where.push('l.employee_id = ?');
    params.push(req.user.id);
  } else if (scope === 'team' || req.user.role === 'manager') {
    where.push('e.manager_id = ?');
    params.push(req.user.id);
  }

  if (req.query.status) { where.push('l.status = ?'); params.push(req.query.status); }
  if (req.query.employee_id && isPrivileged(req.user.role)) {
    where.push('l.employee_id = ?');
    params.push(Number(req.query.employee_id));
  }
  if (req.query.from) { where.push('l.end_date >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('l.start_date <= ?'); params.push(req.query.to); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(300, Math.max(1, Number(req.query.limit) || 100));

  res.json({
    data: db.all(`${SELECT_BASE} ${whereSql} ORDER BY l.created_at DESC LIMIT ?`, [...params, limit]),
  });
}));

// تقديم طلب إجازة
router.post('/', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const typeId = Number(body.leave_type_id);
  const { start_date: startDate, end_date: endDate } = body;

  if (!typeId) throw badRequest('يرجى اختيار نوع الإجازة');
  if (!dates.isValidDate(startDate) || !dates.isValidDate(endDate)) throw badRequest('تواريخ الإجازة غير صالحة');
  if (endDate < startDate) throw badRequest('تاريخ النهاية يجب أن يكون بعد تاريخ البداية');

  const type = db.get('SELECT * FROM leave_types WHERE id = ?', [typeId]);
  if (!type) throw notFound('نوع الإجازة غير معروف');

  // الموارد البشرية يمكنها التقديم نيابة عن موظف آخر
  const employeeId = body.employee_id && isPrivileged(req.user.role)
    ? Number(body.employee_id)
    : req.user.id;

  const days = dates.daysBetween(startDate, endDate);
  if (type.max_days && days > type.max_days) {
    throw badRequest(`الحد الأقصى لـ${type.name_ar} هو ${type.max_days} يوم`);
  }

  const overlap = db.get(
    `SELECT id FROM leaves
      WHERE employee_id = ? AND status IN ('pending','approved')
        AND NOT (end_date < ? OR start_date > ?)`,
    [employeeId, startDate, endDate],
  );
  if (overlap) throw conflict('يوجد طلب إجازة آخر متداخل مع هذه الفترة');

  if (type.deducts_balance) {
    const employee = db.get('SELECT annual_leave_balance FROM employees WHERE id = ?', [employeeId]);
    const usedRow = db.get(
      `SELECT COALESCE(SUM(l.days), 0) AS days
         FROM leaves l JOIN leave_types t ON t.id = l.leave_type_id
        WHERE l.employee_id = ? AND l.status IN ('pending','approved')
          AND t.deducts_balance = 1 AND l.start_date LIKE ?`,
      [employeeId, `${startDate.slice(0, 4)}-%`],
    );
    const remaining = (employee.annual_leave_balance || 0) - usedRow.days;
    if (days > remaining) {
      throw badRequest(`الرصيد المتبقي ${remaining} يوم فقط، والطلب ${days} يوم`);
    }
  }

  const info = db.run(
    `INSERT INTO leaves (employee_id, leave_type_id, start_date, end_date, days, reason, attachment)
     VALUES (?,?,?,?,?,?,?)`,
    [employeeId, typeId, startDate, endDate, days, body.reason || null, body.attachment || null],
  );

  const id = Number(info.lastInsertRowid);
  const employee = db.get('SELECT full_name_ar, manager_id FROM employees WHERE id = ?', [employeeId]);

  notify.push(employee.manager_id, 'طلب إجازة جديد',
    `${employee.full_name_ar} قدّم طلب ${type.name_ar} لمدة ${days} يوم`, '#/leaves');
  notify.pushToRoles(['hr'], 'طلب إجازة جديد',
    `${employee.full_name_ar} — ${type.name_ar} (${days} يوم)`, '#/leaves');

  audit.log(req, 'create', 'leaves', id, { days, type: type.code });
  hooks.emit('leave.requested', {
    leave_id: id, employee_no: db.get('SELECT employee_no FROM employees WHERE id = ?', [employeeId]).employee_no,
    employee_name: employee.full_name_ar, leave_type: type.code,
    start_date: startDate, end_date: endDate, days,
  });
  res.status(201).json({
    data: db.get(`${SELECT_BASE} WHERE l.id = ?`, [id]),
    message: 'تم إرسال طلب الإجازة للاعتماد',
  });
}));

// اعتماد أو رفض
router.post('/:id/decision', requirePermission('leaves:decide'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const decision = req.body.decision;
  if (!['approved', 'rejected'].includes(decision)) throw badRequest('القرار يجب أن يكون اعتماد أو رفض');

  const leave = db.get(`${SELECT_BASE} WHERE l.id = ?`, [id]);
  if (!leave) throw notFound('الطلب غير موجود');
  if (leave.status !== 'pending') throw conflict('تم البتّ في هذا الطلب مسبقاً');
  if (!canDecide(req.user, leave)) throw forbidden('يمكنك اعتماد طلبات فريقك فقط');
  if (leave.employee_id === req.user.id) throw forbidden('لا يمكنك اعتماد طلب إجازتك الخاصة');

  db.transaction(() => {
    db.run(
      `UPDATE leaves SET status = ?, approver_id = ?, decision_note = ?, decided_at = datetime('now')
        WHERE id = ?`,
      [decision, req.user.id, req.body.note || null, id],
    );

    // عند الاعتماد تُعلَّم أيام الإجازة في سجل الحضور
    if (decision === 'approved') {
      let cursor = leave.start_date;
      while (cursor <= leave.end_date) {
        if (!dates.isWeekend(cursor)) {
          db.run(
            `INSERT INTO attendance (employee_id, date, status, source, notes)
             VALUES (?, ?, 'leave', 'system', ?)
             ON CONFLICT(employee_id, date) DO UPDATE SET status = 'leave', notes = excluded.notes`,
            [leave.employee_id, cursor, leave.leave_type_name],
          );
        }
        cursor = dates.addDays(cursor, 1);
      }
    }
  });

  notify.push(leave.employee_id,
    decision === 'approved' ? 'تم اعتماد طلب إجازتك' : 'تم رفض طلب إجازتك',
    `${leave.leave_type_name} من ${leave.start_date} إلى ${leave.end_date}`, '#/leaves');

  audit.log(req, decision === 'approved' ? 'approve' : 'reject', 'leaves', id);
  hooks.emit('leave.decided', {
    leave_id: id, employee_no: leave.employee_no, employee_name: leave.employee_name,
    leave_type: leave.leave_type_code, start_date: leave.start_date, end_date: leave.end_date,
    days: leave.days, decision, decided_by: req.user.full_name_ar,
  });
  res.json({
    data: db.get(`${SELECT_BASE} WHERE l.id = ?`, [id]),
    message: decision === 'approved' ? 'تم اعتماد الطلب' : 'تم رفض الطلب',
  });
}));

// إلغاء الطلب من مقدّمه
router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const leave = db.get('SELECT * FROM leaves WHERE id = ?', [id]);
  if (!leave) throw notFound('الطلب غير موجود');
  if (leave.employee_id !== req.user.id && !['admin', 'hr'].includes(req.user.role)) throw forbidden();
  if (leave.status !== 'pending') throw conflict('لا يمكن إلغاء طلب تم البتّ فيه');

  db.run("UPDATE leaves SET status = 'cancelled', decided_at = datetime('now') WHERE id = ?", [id]);
  audit.log(req, 'cancel', 'leaves', id);
  res.json({ ok: true, message: 'تم إلغاء الطلب' });
}));

module.exports = router;
