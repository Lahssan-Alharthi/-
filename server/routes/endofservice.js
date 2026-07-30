'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler, badRequest, notFound, forbidden, conflict } = require('../utils/http');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { REASONS, computeEndOfService } = require('../utils/eos');
const loansUtil = require('../utils/loans');
const dates = require('../utils/dates');
const audit = require('../utils/audit');
const notify = require('../utils/notify');
const hooks = require('../utils/webhooks');

const router = express.Router();
router.use(requireAuth);

const SELECT_BASE = `
  SELECT s.*, e.full_name_ar AS employee_name, e.employee_no, e.hire_date,
         d.name_ar AS department_name,
         c.full_name_ar AS created_by_name,
         a.full_name_ar AS approved_by_name
    FROM end_of_service s
    JOIN employees e ON e.id = s.employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN employees   c ON c.id = s.created_by
    LEFT JOIN employees   a ON a.id = s.approved_by`;

const canManage = (user) => ['admin', 'hr', 'finance'].includes(user.role);

/**
 * رصيد الإجازة السنوية غير المستنفد حتى يوم العمل الأخير.
 *
 * الاستحقاق يتراكم بالتناسب مع مدة العمل خلال السنة، فمن عمل تسعة أشهر
 * يستحق ثلاثة أرباع الرصيد السنوي لا كامله. وتُخصم الأيام المستهلكة.
 */
function unusedLeaveDays(employeeId, lastWorkingDay) {
  const employee = db.get(
    'SELECT annual_leave_balance, hire_date FROM employees WHERE id = ?', [employeeId],
  );
  const year = String(lastWorkingDay).slice(0, 4);

  const used = db.get(
    `SELECT COALESCE(SUM(l.days), 0) AS days
       FROM leaves l JOIN leave_types t ON t.id = l.leave_type_id
      WHERE l.employee_id = ? AND l.status = 'approved'
        AND t.deducts_balance = 1 AND l.start_date LIKE ?`,
    [employeeId, `${year}-%`],
  ).days;

  // فترة الاستحقاق: من أول السنة أو تاريخ التعيين (الأحدث) إلى آخر يوم عمل
  const yearStart = `${year}-01-01`;
  const periodStart = employee.hire_date && employee.hire_date > yearStart
    ? employee.hire_date : yearStart;

  const daysWorked = dates.daysBetween(periodStart, lastWorkingDay);
  const daysInYear = dates.daysBetween(yearStart, `${year}-12-31`);
  const ratio = Math.min(1, Math.max(0, daysWorked / daysInYear));

  const accrued = (employee.annual_leave_balance || 0) * ratio;
  return Math.max(0, Math.round((accrued - used) * 100) / 100);
}

router.get('/reasons', asyncHandler(async (req, res) => {
  res.json({ data: REASONS });
}));

/** حساب تقديري للمخالصة بلا حفظ — للاطلاع قبل إنهاء الخدمة. */
router.get('/estimate/:employeeId', requirePermission('payroll:read'), asyncHandler(async (req, res) => {
  const employeeId = Number(req.params.employeeId);
  const employee = db.get('SELECT * FROM employees WHERE id = ?', [employeeId]);
  if (!employee) throw notFound('الموظف غير موجود');

  const lastWorkingDay = dates.isValidDate(req.query.last_working_day)
    ? req.query.last_working_day : dates.today();

  const estimate = computeEndOfService(employee, {
    lastWorkingDay,
    reason: req.query.reason,
    unusedLeaveDays: req.query.unused_leave_days !== undefined
      ? Number(req.query.unused_leave_days) : unusedLeaveDays(employeeId, lastWorkingDay),
    otherDues: req.query.other_dues,
    outstandingLoans: req.query.outstanding_loans !== undefined
      ? Number(req.query.outstanding_loans) : loansUtil.outstandingForEmployee(employeeId),
    otherDeductions: req.query.other_deductions,
  });

  res.json({
    data: {
      employee: {
        id: employee.id,
        employee_no: employee.employee_no,
        full_name_ar: employee.full_name_ar,
        job_title: employee.job_title,
        hire_date: employee.hire_date,
        status: employee.status,
      },
      ...estimate,
    },
  });
}));

router.get('/', requirePermission('payroll:read'), asyncHandler(async (req, res) => {
  const where = [];
  const params = [];
  if (req.query.status) { where.push('s.status = ?'); params.push(req.query.status); }
  if (req.query.employee_id) { where.push('s.employee_id = ?'); params.push(Number(req.query.employee_id)); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  res.json({ data: db.all(`${SELECT_BASE} ${whereSql} ORDER BY s.created_at DESC LIMIT 200`, params) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const row = db.get(`${SELECT_BASE} WHERE s.id = ?`, [Number(req.params.id)]);
  if (!row) throw notFound('المخالصة غير موجودة');
  // الموظف يرى مخالصته بعد اعتمادها فقط
  if (row.employee_id !== req.user.id && !canManage(req.user)) throw forbidden();
  if (row.employee_id === req.user.id && row.status === 'draft') throw notFound('المخالصة غير متاحة بعد');

  res.json({ data: row });
}));

/** إنشاء مخالصة نهاية خدمة كمسودة. */
router.post('/', requirePermission('employees:update'), asyncHandler(async (req, res) => {
  const employeeId = Number(req.body.employee_id);
  const employee = db.get('SELECT * FROM employees WHERE id = ?', [employeeId]);
  if (!employee) throw notFound('الموظف غير موجود');

  const lastWorkingDay = req.body.last_working_day;
  if (!dates.isValidDate(lastWorkingDay)) throw badRequest('يوم العمل الأخير غير صالح');
  if (employee.hire_date && lastWorkingDay < employee.hire_date) {
    throw badRequest('يوم العمل الأخير لا يمكن أن يسبق تاريخ التعيين');
  }

  const pending = db.get(
    "SELECT id FROM end_of_service WHERE employee_id = ? AND status <> 'paid'", [employeeId],
  );
  if (pending) throw conflict('توجد مخالصة قائمة لهذا الموظف لم تُصرف بعد');

  const computed = computeEndOfService(employee, {
    lastWorkingDay,
    reason: req.body.reason,
    unusedLeaveDays: req.body.unused_leave_days !== undefined
      ? Number(req.body.unused_leave_days) : unusedLeaveDays(employeeId, lastWorkingDay),
    otherDues: req.body.other_dues,
    outstandingLoans: req.body.outstanding_loans !== undefined
      ? Number(req.body.outstanding_loans) : loansUtil.outstandingForEmployee(employeeId),
    otherDeductions: req.body.other_deductions,
  });

  const info = db.run(
    `INSERT INTO end_of_service (employee_id, last_working_day, reason, service_years,
            monthly_wage, gratuity_amount, gratuity_factor, unused_leave_days, unused_leave_amount,
            other_dues, outstanding_loans, other_deductions, net_amount, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [employeeId, computed.last_working_day, computed.reason, computed.service_years,
      computed.monthly_wage, computed.gratuity_amount, computed.gratuity_factor,
      computed.unused_leave_days, computed.unused_leave_amount, computed.other_dues,
      computed.outstanding_loans, computed.other_deductions, computed.net_amount,
      req.body.notes || null, req.user.id],
  );

  const id = Number(info.lastInsertRowid);
  audit.log(req, 'create', 'end_of_service', id,
    { employee_no: employee.employee_no, reason: computed.reason, net: computed.net_amount });

  res.status(201).json({
    data: db.get(`${SELECT_BASE} WHERE s.id = ?`, [id]),
    computed,
    message: `تم إعداد مخالصة نهاية الخدمة كمسودة — الصافي ${computed.net_amount} ر.س`,
  });
}));

/**
 * اعتماد المخالصة: تُعلَّم الخدمة منتهية، وتُوقف السلف القائمة لأنها
 * سُوّيت داخل المخالصة، ويُشعَر الموظف.
 */
router.post('/:id/approve', requirePermission('payroll:approve'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const settlement = db.get('SELECT * FROM end_of_service WHERE id = ?', [id]);
  if (!settlement) throw notFound('المخالصة غير موجودة');
  if (settlement.status !== 'draft') throw conflict('تم اعتماد هذه المخالصة مسبقاً');

  db.transaction(() => {
    db.run(
      "UPDATE end_of_service SET status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE id = ?",
      [req.user.id, id],
    );

    db.run("UPDATE employees SET status = 'terminated', updated_at = datetime('now') WHERE id = ?",
      [settlement.employee_id]);

    // السلف القائمة سُوّيت ضمن استقطاعات المخالصة
    if (settlement.outstanding_loans > 0) {
      db.run(
        `UPDATE loans SET status = 'settled', settled_at = datetime('now'),
                notes = COALESCE(notes || ' — ', '') || 'سُوّيت في مخالصة نهاية الخدمة'
          WHERE employee_id = ? AND status = 'active'`,
        [settlement.employee_id],
      );
    }
  });

  const employee = db.get('SELECT employee_no, full_name_ar FROM employees WHERE id = ?',
    [settlement.employee_id]);

  notify.push(settlement.employee_id, 'تم اعتماد مخالصة نهاية الخدمة',
    `صافي المستحق ${settlement.net_amount} ر.س`, '#/payroll');

  hooks.emit('end_of_service.approved', {
    employee_no: employee.employee_no,
    last_working_day: settlement.last_working_day,
    reason: settlement.reason,
    service_years: settlement.service_years,
    gratuity_amount: settlement.gratuity_amount,
    net_amount: settlement.net_amount,
  });
  hooks.emit('employee.terminated', {
    employee_no: employee.employee_no,
    last_working_day: settlement.last_working_day,
    reason: settlement.reason,
  });

  audit.log(req, 'approve', 'end_of_service', id, { employee_no: employee.employee_no });
  res.json({
    data: db.get(`${SELECT_BASE} WHERE s.id = ?`, [id]),
    message: `تم اعتماد المخالصة وإنهاء خدمة ${employee.full_name_ar}`,
  });
}));

/** تعليم المخالصة مصروفة. */
router.post('/:id/pay', requirePermission('payroll:approve'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const settlement = db.get('SELECT * FROM end_of_service WHERE id = ?', [id]);
  if (!settlement) throw notFound('المخالصة غير موجودة');
  if (settlement.status !== 'approved') throw conflict('يجب اعتماد المخالصة قبل تعليمها مصروفة');

  db.run("UPDATE end_of_service SET status = 'paid' WHERE id = ?", [id]);
  audit.log(req, 'pay', 'end_of_service', id);

  res.json({ ok: true, message: 'تم تعليم المخالصة كمصروفة' });
}));

router.delete('/:id', requirePermission('payroll:delete'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const settlement = db.get('SELECT status FROM end_of_service WHERE id = ?', [id]);
  if (!settlement) throw notFound('المخالصة غير موجودة');
  if (settlement.status !== 'draft') throw conflict('لا يمكن حذف مخالصة معتمدة');

  db.run('DELETE FROM end_of_service WHERE id = ?', [id]);
  audit.log(req, 'delete', 'end_of_service', id);

  res.json({ ok: true, message: 'تم حذف المسودة' });
}));

module.exports = router;
