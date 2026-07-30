'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler, badRequest, notFound, forbidden, conflict } = require('../utils/http');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { isPrivileged } = require('../utils/rbac');
const audit = require('../utils/audit');
const notify = require('../utils/notify');
const hooks = require('../utils/webhooks');
const loansUtil = require('../utils/loans');
const config = require('../config');

const router = express.Router();
router.use(requireAuth);

const TYPES = [
  'خطاب تعريف',
  'شهادة راتب',
  'سلفة',
  'تعديل بيانات',
  'تجديد إقامة',
  'إصدار بطاقة موظف',
  'شكوى أو اقتراح',
  'أخرى',
];

/** الطلبات المالية تُوجَّه للمالية، والباقي للموارد البشرية. */
const FINANCE_TYPES = new Set(['سلفة', 'شهادة راتب']);

const SELECT_BASE = `
  SELECT r.*, e.full_name_ar AS employee_name, e.employee_no, e.manager_id,
         d.name_ar AS department_name, a.full_name_ar AS assignee_name
    FROM service_requests r
    JOIN employees e ON e.id = r.employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN employees   a ON a.id = r.assignee_id`;

router.get('/types', asyncHandler(async (req, res) => {
  res.json({ data: TYPES });
}));

router.get('/', asyncHandler(async (req, res) => {
  const where = [];
  const params = [];
  const scope = req.query.scope || (isPrivileged(req.user.role) ? 'all' : 'mine');

  if (scope === 'mine' || !isPrivileged(req.user.role)) {
    where.push('r.employee_id = ?');
    params.push(req.user.id);
  } else if (req.user.role === 'manager') {
    where.push('(e.manager_id = ? OR r.employee_id = ?)');
    params.push(req.user.id, req.user.id);
  }

  if (req.query.status) { where.push('r.status = ?'); params.push(req.query.status); }
  if (req.query.type) { where.push('r.type = ?'); params.push(req.query.type); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  res.json({
    data: db.all(`${SELECT_BASE} ${whereSql} ORDER BY r.created_at DESC LIMIT 300`, params),
  });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const row = db.get(`${SELECT_BASE} WHERE r.id = ?`, [Number(req.params.id)]);
  if (!row) throw notFound('الطلب غير موجود');
  if (row.employee_id !== req.user.id && !isPrivileged(req.user.role)) throw forbidden();
  res.json({ data: row });
}));

router.post('/', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const type = TYPES.includes(body.type) ? body.type : null;
  if (!type) throw badRequest('نوع الطلب غير معروف');
  if (!String(body.subject || '').trim()) throw badRequest('موضوع الطلب إلزامي');

  const amount = type === 'سلفة' ? Number(body.amount) : null;
  if (type === 'سلفة' && (!amount || amount <= 0)) throw badRequest('يرجى تحديد مبلغ السلفة');

  const info = db.run(
    'INSERT INTO service_requests (employee_id, type, subject, details, amount) VALUES (?,?,?,?,?)',
    [req.user.id, type, String(body.subject).trim(), body.details || null, amount],
  );

  const id = Number(info.lastInsertRowid);
  notify.pushToRoles(FINANCE_TYPES.has(type) ? ['finance', 'hr'] : ['hr'],
    'طلب خدمة جديد', `${req.user.full_name_ar} — ${type}`, '#/requests');

  audit.log(req, 'create', 'service_requests', id, { type });
  res.status(201).json({
    data: db.get(`${SELECT_BASE} WHERE r.id = ?`, [id]),
    message: 'تم إرسال الطلب وسيتم الرد عليه قريباً',
  });
}));

router.post('/:id/decision', requirePermission('requests:decide'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const decision = req.body.decision;
  if (!['approved', 'rejected', 'in_progress'].includes(decision)) throw badRequest('القرار غير صالح');

  const request = db.get('SELECT * FROM service_requests WHERE id = ?', [id]);
  if (!request) throw notFound('الطلب غير موجود');
  if (['approved', 'rejected'].includes(request.status)) throw conflict('تم البتّ في هذا الطلب مسبقاً');
  if (request.employee_id === req.user.id) throw forbidden('لا يمكنك البتّ في طلبك الخاص');

  db.run(
    `UPDATE service_requests
        SET status = ?, response = ?, assignee_id = ?,
            decided_at = CASE WHEN ? = 'in_progress' THEN NULL ELSE datetime('now') END
      WHERE id = ?`,
    [decision, req.body.response || null, req.user.id, decision, id],
  );

  // اعتماد السلفة يُنشئ جدول أقساط يُخصم شهرياً من الراتب
  let loanId = null;
  if (decision === 'approved' && request.type === 'سلفة' && request.amount > 0) {
    const existing = db.get('SELECT id FROM loans WHERE request_id = ?', [id]);
    if (!existing) {
      // صاحب الصلاحية يحدّد عدد الأقساط أو مبلغ القسط عند الاعتماد
      const schedule = loansUtil.resolveSchedule(request.amount, {
        installments: req.body.installments,
        monthlyAmount: req.body.monthly_amount,
      });
      if (schedule.error) throw badRequest(schedule.error);
      const installments = Math.min(schedule.installments, config.payroll.maxLoanInstallments);

      const now = new Date();
      loanId = loansUtil.createLoan({
        employeeId: request.employee_id,
        requestId: id,
        amount: request.amount,
        installments,
        monthlyAmount: schedule.monthly,
        startYear: Number(req.body.start_year) || now.getFullYear(),
        startMonth: Number(req.body.start_month) || now.getMonth() + 1,
        approvedBy: req.user.id,
        notes: req.body.response || null,
      });
    }
  }

  const labels = { approved: 'تم اعتماد طلبك', rejected: 'تم رفض طلبك', in_progress: 'طلبك قيد المعالجة' };
  notify.push(request.employee_id, labels[decision], `${request.type} — ${request.subject}`, '#/requests');

  audit.log(req, 'decide', 'service_requests', id, { decision });
  hooks.emit('request.decided', {
    request_id: id, type: request.type, subject: request.subject,
    amount: request.amount, decision, decided_by: req.user.full_name_ar,
  });
  const loan = loanId ? loansUtil.present(db.get('SELECT * FROM loans WHERE id = ?', [loanId])) : null;
  res.json({
    data: db.get(`${SELECT_BASE} WHERE r.id = ?`, [id]),
    loan,
    message: loan
      ? `${labels[decision]} — ستُخصم على ${loan.installments} قسط بمقدار ${loan.monthly_amount} ر.س شهرياً`
      : labels[decision],
  });
}));

router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const request = db.get('SELECT * FROM service_requests WHERE id = ?', [id]);
  if (!request) throw notFound('الطلب غير موجود');
  if (request.employee_id !== req.user.id && !['admin', 'hr'].includes(req.user.role)) throw forbidden();
  if (request.status !== 'pending') throw conflict('لا يمكن إلغاء طلب تمت معالجته');

  db.run("UPDATE service_requests SET status = 'cancelled', decided_at = datetime('now') WHERE id = ?", [id]);
  audit.log(req, 'cancel', 'service_requests', id);
  res.json({ ok: true, message: 'تم إلغاء الطلب' });
}));

module.exports = router;
