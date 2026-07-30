'use strict';

const express = require('express');
const db = require('../db');
const config = require('../config');
const { asyncHandler, badRequest, notFound, forbidden, conflict } = require('../utils/http');
const { requireAuth, requirePermission } = require('../middleware/auth');
const loansUtil = require('../utils/loans');
const audit = require('../utils/audit');
const notify = require('../utils/notify');
const hooks = require('../utils/webhooks');

const router = express.Router();
router.use(requireAuth);

const SELECT_BASE = `
  SELECT l.*, e.full_name_ar AS employee_name, e.employee_no,
         a.full_name_ar AS approved_by_name
    FROM loans l
    JOIN employees e ON e.id = l.employee_id
    LEFT JOIN employees a ON a.id = l.approved_by`;

const canSeeAll = (user) => ['admin', 'hr', 'finance'].includes(user.role);

// قائمة السلف — الموظف يرى سلفه فقط
router.get('/', asyncHandler(async (req, res) => {
  const where = [];
  const params = [];

  if (!canSeeAll(req.user)) {
    where.push('l.employee_id = ?');
    params.push(req.user.id);
  } else if (req.query.employee_id) {
    where.push('l.employee_id = ?');
    params.push(Number(req.query.employee_id));
  }

  if (req.query.status) { where.push('l.status = ?'); params.push(req.query.status); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db.all(`${SELECT_BASE} ${whereSql} ORDER BY l.created_at DESC LIMIT 300`, params);

  res.json({
    data: rows.map(loansUtil.present),
    summary: {
      outstanding: canSeeAll(req.user) && !req.query.employee_id
        ? rows.filter((l) => l.status === 'active')
          .reduce((sum, l) => sum + loansUtil.remainingAmount(l), 0)
        : loansUtil.outstandingForEmployee(
          req.query.employee_id && canSeeAll(req.user) ? Number(req.query.employee_id) : req.user.id,
        ),
    },
  });
}));

// تفاصيل سلفة مع جدول أقساطها
router.get('/:id', asyncHandler(async (req, res) => {
  const loan = db.get(`${SELECT_BASE} WHERE l.id = ?`, [Number(req.params.id)]);
  if (!loan) throw notFound('السلفة غير موجودة');
  if (loan.employee_id !== req.user.id && !canSeeAll(req.user)) throw forbidden();

  const payments = db.all(
    `SELECT p.year, p.month, p.amount, p.created_at, r.status AS run_status
       FROM loan_payments p LEFT JOIN payroll_runs r ON r.id = p.run_id
      WHERE p.loan_id = ? ORDER BY p.year, p.month`,
    [loan.id],
  );

  res.json({ data: { ...loansUtil.present(loan), payments } });
}));

/** إنشاء سلفة مباشرة (بلا طلب خدمة) — للمالية والموارد البشرية. */
router.post('/', requirePermission('payroll:create'), asyncHandler(async (req, res) => {
  const employeeId = Number(req.body.employee_id);
  const amount = Number(req.body.amount);

  if (!employeeId || !db.get('SELECT id FROM employees WHERE id = ?', [employeeId])) {
    throw notFound('الموظف غير موجود');
  }
  if (!amount || amount <= 0) throw badRequest('مبلغ السلفة يجب أن يكون أكبر من صفر');

  // صاحب الصلاحية يحدّد عدد الأقساط أو مبلغ القسط الشهري، والآخر يُشتقّ منه
  const schedule = loansUtil.resolveSchedule(amount, {
    installments: req.body.installments,
    monthlyAmount: req.body.monthly_amount,
  });
  if (schedule.error) throw badRequest(schedule.error);
  if (schedule.installments > config.payroll.maxLoanInstallments) {
    throw badRequest(
      `الجدول المطلوب يحتاج ${schedule.installments} قسطاً، والحد الأقصى ${config.payroll.maxLoanInstallments}`,
    );
  }

  const now = new Date();
  const id = loansUtil.createLoan({
    employeeId,
    amount,
    installments: schedule.installments,
    monthlyAmount: schedule.monthly,
    startYear: Number(req.body.start_year) || now.getFullYear(),
    startMonth: Number(req.body.start_month) || now.getMonth() + 1,
    approvedBy: req.user.id,
    notes: req.body.notes || null,
  });

  const loan = loansUtil.present(db.get('SELECT * FROM loans WHERE id = ?', [id]));
  notify.push(employeeId, 'تم تسجيل سلفة على راتبك',
    `${loan.amount} ر.س على ${loan.installments} قسط بمقدار ${loan.monthly_amount} ر.س شهرياً`, '#/payroll');

  hooks.emit('loan.created', {
    employee_no: db.get('SELECT employee_no FROM employees WHERE id = ?', [employeeId]).employee_no,
    amount: loan.amount, installments: loan.installments, monthly_amount: loan.monthly_amount,
  });
  audit.log(req, 'create', 'loans', id,
    { employee_id: employeeId, amount, installments: loan.installments });
  res.status(201).json({
    data: loan,
    message: `تم تسجيل السلفة على ${loan.installments} قسط بمقدار ${loan.monthly_amount} ر.س شهرياً`,
  });
}));

/** تعديل جدول الأقساط لسلفة قائمة. */
router.put('/:id', requirePermission('payroll:update'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const loan = db.get('SELECT * FROM loans WHERE id = ?', [id]);
  if (!loan) throw notFound('السلفة غير موجودة');
  if (loan.status !== 'active') throw conflict('لا يمكن تعديل سلفة منتهية أو ملغاة');

  const paid = loansUtil.paidAmount(id);
  const updates = [];
  const params = [];

  // إعادة الجدولة على ما تبقّى: بعدد أقساط جديد أو بمبلغ قسط جديد
  if (req.body.installments !== undefined || req.body.monthly_amount !== undefined) {
    const remaining = Math.round((loan.amount - paid) * 100) / 100;
    if (remaining <= 0) throw conflict('لا يوجد رصيد متبقٍ لإعادة جدولته');

    const schedule = loansUtil.resolveSchedule(remaining, {
      installments: req.body.installments,
      monthlyAmount: req.body.monthly_amount,
    });
    if (schedule.error) throw badRequest(schedule.error);

    const paidCount = db.get(
      'SELECT COUNT(*) AS n FROM loan_payments WHERE loan_id = ?', [id],
    ).n;
    const totalInstallments = paidCount + schedule.installments;
    if (totalInstallments > config.payroll.maxLoanInstallments) {
      throw badRequest(
        `الجدول الجديد يرفع الأقساط إلى ${totalInstallments}، والحد الأقصى ${config.payroll.maxLoanInstallments}`,
      );
    }

    updates.push('installments = ?', 'monthly_amount = ?');
    params.push(totalInstallments, schedule.monthly);
  }

  if (req.body.notes !== undefined) { updates.push('notes = ?'); params.push(req.body.notes || null); }

  if (!updates.length) throw badRequest('لا توجد حقول للتعديل');

  db.run(`UPDATE loans SET ${updates.join(', ')} WHERE id = ?`, [...params, id]);
  audit.log(req, 'update', 'loans', id);

  res.json({
    data: loansUtil.present(db.get('SELECT * FROM loans WHERE id = ?', [id])),
    message: 'تم تحديث جدول الأقساط',
  });
}));

/** إلغاء ما تبقّى من سلفة (إعفاء أو تسوية خارج الراتب). */
router.post('/:id/cancel', requirePermission('payroll:update'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const loan = db.get('SELECT * FROM loans WHERE id = ?', [id]);
  if (!loan) throw notFound('السلفة غير موجودة');
  if (loan.status !== 'active') throw conflict('السلفة غير نشطة');

  const remaining = loansUtil.remainingAmount(loan);
  db.run("UPDATE loans SET status = 'cancelled', settled_at = datetime('now'), notes = ? WHERE id = ?",
    [req.body.reason || loan.notes, id]);

  audit.log(req, 'cancel', 'loans', id, { remaining });
  res.json({ ok: true, message: `تم إيقاف خصم السلفة، والمتبقّي ${remaining} ر.س لم يُخصم` });
}));

module.exports = router;
