'use strict';

const express = require('express');
const db = require('../db');
const config = require('../config');
const { asyncHandler, badRequest, notFound, forbidden, conflict } = require('../utils/http');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { isPrivileged } = require('../utils/rbac');
const dates = require('../utils/dates');
const audit = require('../utils/audit');
const hooks = require('../utils/webhooks');

const router = express.Router();
router.use(requireAuth);

const STATUSES = ['present', 'late', 'absent', 'leave', 'remote', 'holiday', 'mission'];

/** يقرأ سياسة الدوام من الإعدادات مع الرجوع للقيم الافتراضية. */
function workPolicy() {
  const rows = db.all("SELECT key, value FROM settings WHERE key LIKE 'work.%'");
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    startTime: map['work.start_time'] || config.work.startTime,
    endTime: map['work.end_time'] || config.work.endTime,
    graceMinutes: Number(map['work.grace_minutes'] ?? config.work.graceMinutes),
  };
}

/** يحسب دقائق التأخير والعمل الإضافي وساعات العمل لسجل حضور. */
function computeMetrics(checkIn, checkOut) {
  const policy = workPolicy();
  const startMin = dates.toMinutes(policy.startTime);
  const endMin = dates.toMinutes(policy.endTime);
  const inMin = dates.toMinutes(checkIn);
  const outMin = dates.toMinutes(checkOut);

  const late = inMin !== null ? Math.max(0, inMin - startMin - policy.graceMinutes) : 0;
  const earlyLeave = outMin !== null ? Math.max(0, endMin - outMin) : 0;
  const overtime = outMin !== null ? Math.max(0, outMin - endMin) : 0;
  const work = inMin !== null && outMin !== null ? Math.max(0, outMin - inMin) : 0;

  return {
    late_minutes: late,
    early_leave_minutes: earlyLeave,
    overtime_minutes: overtime,
    work_minutes: work,
    status: late > 0 ? 'late' : 'present',
  };
}

const SELECT_BASE = `
  SELECT a.*, e.full_name_ar AS employee_name, e.employee_no, d.name_ar AS department_name
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    LEFT JOIN departments d ON d.id = e.department_id`;

// سجل الحضور (مع تصفية)
router.get('/', asyncHandler(async (req, res) => {
  const { from, to, status, department_id: deptId } = req.query;
  let employeeId = req.query.employee_id ? Number(req.query.employee_id) : null;

  // الموظف العادي يرى سجله فقط
  if (!isPrivileged(req.user.role)) employeeId = req.user.id;

  const where = [];
  const params = [];

  if (employeeId) { where.push('a.employee_id = ?'); params.push(employeeId); }
  if (req.user.role === 'manager' && !employeeId) {
    where.push('(e.manager_id = ? OR e.id = ?)');
    params.push(req.user.id, req.user.id);
  }
  if (from) { where.push('a.date >= ?'); params.push(from); }
  if (to) { where.push('a.date <= ?'); params.push(to); }
  if (status) { where.push('a.status = ?'); params.push(status); }
  if (deptId) { where.push('e.department_id = ?'); params.push(Number(deptId)); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));

  const rows = db.all(
    `${SELECT_BASE} ${whereSql} ORDER BY a.date DESC, e.full_name_ar LIMIT ?`,
    [...params, limit],
  );

  res.json({ data: rows });
}));

// حالة اليوم للمستخدم الحالي
router.get('/today', asyncHandler(async (req, res) => {
  const date = dates.today();
  const record = db.get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', [req.user.id, date]);
  const policy = workPolicy();

  res.json({
    data: {
      date,
      server_time: dates.nowTime(),
      is_weekend: dates.isWeekend(date),
      policy,
      record: record || null,
      can_check_in: !record || !record.check_in,
      can_check_out: Boolean(record && record.check_in && !record.check_out),
    },
  });
}));

// تسجيل الحضور
router.post('/check-in', asyncHandler(async (req, res) => {
  const date = dates.today();
  const time = dates.nowTime();

  const existing = db.get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', [req.user.id, date]);
  if (existing && existing.check_in) throw conflict('تم تسجيل حضورك لهذا اليوم مسبقاً');

  const metrics = computeMetrics(time, null);

  if (existing) {
    db.run(
      'UPDATE attendance SET check_in = ?, status = ?, late_minutes = ?, notes = ? WHERE id = ?',
      [time, metrics.status, metrics.late_minutes, req.body.notes || existing.notes, existing.id],
    );
  } else {
    db.run(
      `INSERT INTO attendance (employee_id, date, check_in, status, late_minutes, source, notes)
       VALUES (?,?,?,?,?,'portal',?)`,
      [req.user.id, date, time, metrics.status, metrics.late_minutes, req.body.notes || null],
    );
  }

  audit.log(req, 'check_in', 'attendance', null, { date, time });
  hooks.emit('attendance.recorded', {
    employee_no: req.user.employee_no, employee_name: req.user.full_name_ar,
    date, action: 'check_in', time, late_minutes: metrics.late_minutes,
  });
  const record = db.get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', [req.user.id, date]);

  res.json({
    data: record,
    message: metrics.late_minutes > 0
      ? `تم تسجيل الحضور الساعة ${time} (تأخير ${metrics.late_minutes} دقيقة)`
      : `تم تسجيل الحضور الساعة ${time}`,
  });
}));

// تسجيل الانصراف
router.post('/check-out', asyncHandler(async (req, res) => {
  const date = dates.today();
  const time = dates.nowTime();

  const record = db.get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', [req.user.id, date]);
  if (!record || !record.check_in) throw badRequest('لا يوجد تسجيل حضور لهذا اليوم');
  if (record.check_out) throw conflict('تم تسجيل انصرافك لهذا اليوم مسبقاً');

  const metrics = computeMetrics(record.check_in, time);
  db.run(
    `UPDATE attendance
        SET check_out = ?, work_minutes = ?, overtime_minutes = ?, early_leave_minutes = ?
      WHERE id = ?`,
    [time, metrics.work_minutes, metrics.overtime_minutes, metrics.early_leave_minutes, record.id],
  );

  audit.log(req, 'check_out', 'attendance', record.id, { date, time });
  hooks.emit('attendance.recorded', {
    employee_no: req.user.employee_no, employee_name: req.user.full_name_ar,
    date, action: 'check_out', time, work_minutes: metrics.work_minutes,
  });
  res.json({
    data: db.get('SELECT * FROM attendance WHERE id = ?', [record.id]),
    message: `تم تسجيل الانصراف الساعة ${time} — مدة العمل ${(metrics.work_minutes / 60).toFixed(1)} ساعة`,
  });
}));

// إدخال أو تعديل سجل حضور يدوياً (الموارد البشرية)
router.post('/', requirePermission('attendance:create'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  const employeeId = Number(body.employee_id);
  const date = body.date;

  if (!employeeId || !dates.isValidDate(date)) throw badRequest('يرجى تحديد الموظف والتاريخ بشكل صحيح');
  if (!db.get('SELECT id FROM employees WHERE id = ?', [employeeId])) throw notFound('الموظف غير موجود');

  const status = STATUSES.includes(body.status) ? body.status : 'present';
  const metrics = computeMetrics(body.check_in, body.check_out);

  db.run(
    `INSERT INTO attendance (employee_id, date, check_in, check_out, status, work_minutes,
                             late_minutes, overtime_minutes, early_leave_minutes, source, notes)
     VALUES (?,?,?,?,?,?,?,?,?, 'manual', ?)
     ON CONFLICT(employee_id, date) DO UPDATE SET
        check_in = excluded.check_in,
        check_out = excluded.check_out,
        status = excluded.status,
        work_minutes = excluded.work_minutes,
        late_minutes = excluded.late_minutes,
        overtime_minutes = excluded.overtime_minutes,
        early_leave_minutes = excluded.early_leave_minutes,
        source = 'manual',
        notes = excluded.notes`,
    [employeeId, date, body.check_in || null, body.check_out || null, status,
      metrics.work_minutes, ['absent', 'leave', 'holiday'].includes(status) ? 0 : metrics.late_minutes,
      metrics.overtime_minutes, metrics.early_leave_minutes, body.notes || null],
  );

  audit.log(req, 'manual_attendance', 'attendance', employeeId, { date, status });
  res.status(201).json({
    data: db.get('SELECT * FROM attendance WHERE employee_id = ? AND date = ?', [employeeId, date]),
    message: 'تم حفظ سجل الحضور',
  });
}));

router.delete('/:id', requirePermission('attendance:delete'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!db.get('SELECT id FROM attendance WHERE id = ?', [id])) throw notFound('السجل غير موجود');

  db.run('DELETE FROM attendance WHERE id = ?', [id]);
  audit.log(req, 'delete', 'attendance', id);
  res.json({ ok: true, message: 'تم حذف السجل' });
}));

// ملخّص شهري لموظف
router.get('/summary/:employeeId', asyncHandler(async (req, res) => {
  const employeeId = Number(req.params.employeeId);
  if (employeeId !== req.user.id && !isPrivileged(req.user.role)) throw forbidden();

  const now = new Date();
  const year = Number(req.query.year) || now.getFullYear();
  const month = Number(req.query.month) || now.getMonth() + 1;
  const { from, to } = dates.monthRange(year, month);

  const summary = db.get(
    `SELECT COUNT(*) AS records,
            SUM(CASE WHEN status IN ('present','remote','mission') THEN 1 ELSE 0 END) AS present_days,
            SUM(CASE WHEN status = 'late'   THEN 1 ELSE 0 END) AS late_days,
            SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS absent_days,
            SUM(CASE WHEN status = 'leave'  THEN 1 ELSE 0 END) AS leave_days,
            COALESCE(SUM(work_minutes), 0)     AS work_minutes,
            COALESCE(SUM(late_minutes), 0)     AS late_minutes,
            COALESCE(SUM(overtime_minutes), 0) AS overtime_minutes
       FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ?`,
    [employeeId, from, to],
  );

  res.json({
    data: {
      year,
      month,
      working_days: dates.workingDaysBetween(from, to),
      ...summary,
      records: db.all(
        'SELECT * FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ? ORDER BY date',
        [employeeId, from, to],
      ),
    },
  });
}));

module.exports = { router, computeMetrics, workPolicy };
