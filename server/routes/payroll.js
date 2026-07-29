'use strict';

const express = require('express');
const db = require('../db');
const config = require('../config');
const { asyncHandler, badRequest, notFound, forbidden, conflict } = require('../utils/http');
const { requireAuth, requirePermission } = require('../middleware/auth');
const dates = require('../utils/dates');
const audit = require('../utils/audit');
const notify = require('../utils/notify');

const router = express.Router();
router.use(requireAuth);

const MONTH_NAMES = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * يحسب مسيّر رواتب موظف واحد لشهر معيّن:
 * الأساسي + البدلات + الوقت الإضافي - (التأمينات + الغياب + السلف).
 */
function computePayslip(employee, year, month) {
  const { from, to, days: daysInMonth } = dates.monthRange(year, month);

  const attendance = db.get(
    `SELECT SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS absent_days,
            COALESCE(SUM(overtime_minutes), 0) AS overtime_minutes
       FROM attendance WHERE employee_id = ? AND date BETWEEN ? AND ?`,
    [employee.id, from, to],
  );

  const basic = Number(employee.basic_salary) || 0;
  const housing = Number(employee.housing_allowance) || 0;
  const transport = Number(employee.transport_allowance) || 0;
  const other = Number(employee.other_allowance) || 0;

  const absentDays = attendance.absent_days || 0;
  const overtimeHours = (attendance.overtime_minutes || 0) / 60;

  const dailyRate = basic / daysInMonth;
  const hourlyRate = basic / (daysInMonth * 8);

  const overtimeAmount = round2(overtimeHours * hourlyRate * config.payroll.overtimeRatePerHour);
  const absenceDeduction = round2(absentDays * dailyRate);
  const gosi = round2((basic + housing) * config.payroll.gosiRate);

  // السلف المعتمدة تُخصم بالكامل في الشهر الذي اعتُمدت فيه
  const loans = db.get(
    `SELECT COALESCE(SUM(amount), 0) AS total
       FROM service_requests
      WHERE employee_id = ? AND type = 'سلفة' AND status = 'approved'
        AND decided_at BETWEEN ? AND ?`,
    [employee.id, `${from} 00:00:00`, `${to} 23:59:59`],
  ).total;

  const gross = round2(basic + housing + transport + other + overtimeAmount);
  const deductions = round2(gosi + absenceDeduction + loans);

  return {
    basic_salary: round2(basic),
    housing_allowance: round2(housing),
    transport_allowance: round2(transport),
    other_allowance: round2(other),
    overtime_amount: overtimeAmount,
    overtime_hours: round2(overtimeHours),
    gosi_deduction: gosi,
    absence_deduction: absenceDeduction,
    loan_deduction: round2(loans),
    other_deduction: 0,
    absent_days: absentDays,
    gross_amount: gross,
    net_amount: round2(gross - deductions),
  };
}

// قائمة مسيّرات الرواتب
router.get('/runs', requirePermission('payroll:read'), asyncHandler(async (req, res) => {
  const rows = db.all(
    `SELECT r.*, c.full_name_ar AS created_by_name, a.full_name_ar AS approved_by_name,
            (SELECT COUNT(*) FROM payslips p WHERE p.run_id = r.id) AS employees_count
       FROM payroll_runs r
       LEFT JOIN employees c ON c.id = r.created_by
       LEFT JOIN employees a ON a.id = r.approved_by
      ORDER BY r.year DESC, r.month DESC`,
  );
  res.json({ data: rows.map((r) => ({ ...r, month_name: MONTH_NAMES[r.month - 1] })) });
}));

// تفاصيل مسيّر
router.get('/runs/:id', requirePermission('payroll:read'), asyncHandler(async (req, res) => {
  const run = db.get('SELECT * FROM payroll_runs WHERE id = ?', [Number(req.params.id)]);
  if (!run) throw notFound('المسيّر غير موجود');

  run.month_name = MONTH_NAMES[run.month - 1];
  run.payslips = db.all(
    `SELECT p.*, e.full_name_ar AS employee_name, e.employee_no, e.job_title, e.iban, e.bank_name,
            d.name_ar AS department_name
       FROM payslips p
       JOIN employees e ON e.id = p.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
      WHERE p.run_id = ? ORDER BY e.full_name_ar`,
    [run.id],
  );

  res.json({ data: run });
}));

// توليد مسيّر رواتب شهري
router.post('/runs', requirePermission('payroll:create'), asyncHandler(async (req, res) => {
  const year = Number(req.body.year);
  const month = Number(req.body.month);

  if (!year || month < 1 || month > 12) throw badRequest('يرجى تحديد السنة والشهر بشكل صحيح');
  if (db.get('SELECT id FROM payroll_runs WHERE year = ? AND month = ?', [year, month])) {
    throw conflict(`يوجد مسيّر رواتب لشهر ${MONTH_NAMES[month - 1]} ${year} بالفعل`);
  }

  const employees = db.all(
    "SELECT * FROM employees WHERE status = 'active' AND basic_salary > 0 ORDER BY full_name_ar",
  );
  if (!employees.length) throw badRequest('لا يوجد موظفون نشطون لديهم رواتب مسجّلة');

  const runId = db.transaction(() => {
    const info = db.run(
      'INSERT INTO payroll_runs (year, month, status, created_by, notes) VALUES (?,?,?,?,?)',
      [year, month, 'draft', req.user.id, req.body.notes || null],
    );
    const id = Number(info.lastInsertRowid);

    let totalGross = 0;
    let totalNet = 0;

    employees.forEach((employee) => {
      const slip = computePayslip(employee, year, month);
      totalGross += slip.gross_amount;
      totalNet += slip.net_amount;

      db.run(
        `INSERT INTO payslips (run_id, employee_id, basic_salary, housing_allowance,
            transport_allowance, other_allowance, overtime_amount, gosi_deduction,
            absence_deduction, loan_deduction, other_deduction, gross_amount, net_amount,
            absent_days, overtime_hours)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, employee.id, slip.basic_salary, slip.housing_allowance, slip.transport_allowance,
          slip.other_allowance, slip.overtime_amount, slip.gosi_deduction, slip.absence_deduction,
          slip.loan_deduction, slip.other_deduction, slip.gross_amount, slip.net_amount,
          slip.absent_days, slip.overtime_hours],
      );
    });

    db.run('UPDATE payroll_runs SET total_gross = ?, total_net = ? WHERE id = ?',
      [round2(totalGross), round2(totalNet), id]);

    return id;
  });

  audit.log(req, 'create', 'payroll_runs', runId, { year, month, employees: employees.length });
  res.status(201).json({
    data: db.get('SELECT * FROM payroll_runs WHERE id = ?', [runId]),
    message: `تم توليد مسيّر رواتب ${MONTH_NAMES[month - 1]} ${year} لعدد ${employees.length} موظف`,
  });
}));

// اعتماد المسيّر
router.post('/runs/:id/approve', requirePermission('payroll:approve'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const run = db.get('SELECT * FROM payroll_runs WHERE id = ?', [id]);
  if (!run) throw notFound('المسيّر غير موجود');
  if (run.status !== 'draft') throw conflict('تم اعتماد هذا المسيّر مسبقاً');

  db.run(
    "UPDATE payroll_runs SET status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE id = ?",
    [req.user.id, id],
  );

  const recipients = db.all('SELECT employee_id FROM payslips WHERE run_id = ?', [id]);
  notify.pushMany(recipients.map((r) => r.employee_id), 'صدر إشعار راتبك',
    `راتب شهر ${MONTH_NAMES[run.month - 1]} ${run.year} متاح الآن`, '#/payroll');

  audit.log(req, 'approve', 'payroll_runs', id);
  res.json({ ok: true, message: 'تم اعتماد المسيّر وإشعار الموظفين' });
}));

router.delete('/runs/:id', requirePermission('payroll:delete'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const run = db.get('SELECT * FROM payroll_runs WHERE id = ?', [id]);
  if (!run) throw notFound('المسيّر غير موجود');
  if (run.status === 'approved') throw conflict('لا يمكن حذف مسيّر معتمد');

  db.run('DELETE FROM payroll_runs WHERE id = ?', [id]);
  audit.log(req, 'delete', 'payroll_runs', id);
  res.json({ ok: true, message: 'تم حذف المسيّر' });
}));

// إشعارات راتب الموظف
router.get('/my-payslips', asyncHandler(async (req, res) => {
  const employeeId = req.query.employee_id && ['admin', 'hr', 'finance'].includes(req.user.role)
    ? Number(req.query.employee_id)
    : req.user.id;

  const rows = db.all(
    `SELECT p.*, r.year, r.month, r.status AS run_status, r.approved_at
       FROM payslips p JOIN payroll_runs r ON r.id = p.run_id
      WHERE p.employee_id = ? AND r.status = 'approved'
      ORDER BY r.year DESC, r.month DESC`,
    [employeeId],
  );

  res.json({ data: rows.map((r) => ({ ...r, month_name: MONTH_NAMES[r.month - 1] })) });
}));

// إشعار راتب مفصّل
router.get('/payslips/:id', asyncHandler(async (req, res) => {
  const row = db.get(
    `SELECT p.*, r.year, r.month, r.status AS run_status, r.approved_at,
            e.full_name_ar AS employee_name, e.employee_no, e.job_title, e.iban, e.bank_name,
            d.name_ar AS department_name
       FROM payslips p
       JOIN payroll_runs r ON r.id = p.run_id
       JOIN employees e    ON e.id = p.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
      WHERE p.id = ?`,
    [Number(req.params.id)],
  );

  if (!row) throw notFound('إشعار الراتب غير موجود');
  if (row.employee_id !== req.user.id && !['admin', 'hr', 'finance'].includes(req.user.role)) throw forbidden();
  if (row.employee_id === req.user.id && row.run_status !== 'approved') throw notFound('إشعار الراتب غير متاح بعد');

  row.month_name = MONTH_NAMES[row.month - 1];
  res.json({ data: row });
}));

module.exports = { router, computePayslip, MONTH_NAMES };
