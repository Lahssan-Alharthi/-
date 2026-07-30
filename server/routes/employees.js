'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler, badRequest, notFound, forbidden, conflict } = require('../utils/http');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { hashPassword, generateTempPassword } = require('../utils/password');
const { ROLE_KEYS, isPrivileged } = require('../utils/rbac');
const { isValidDate } = require('../utils/dates');
const audit = require('../utils/audit');
const hooks = require('../utils/webhooks');

const router = express.Router();
router.use(requireAuth);

const SELECT_BASE = `
  SELECT e.id, e.employee_no, e.national_id, e.full_name_ar, e.full_name_en, e.email, e.phone,
         e.role, e.job_title, e.department_id, e.manager_id, e.hire_date, e.contract_type,
         e.status, e.nationality, e.gender, e.birth_date, e.marital_status, e.address,
         e.emergency_contact, e.emergency_phone, e.iqama_expiry, e.gosi_join_date, e.license_no, e.license_expiry,
         e.basic_salary, e.housing_allowance, e.transport_allowance, e.other_allowance,
         e.bank_name, e.iban, e.annual_leave_balance, e.avatar, e.last_login_at, e.created_at,
         d.name_ar AS department_name,
         m.full_name_ar AS manager_name
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN employees   m ON m.id = e.manager_id`;

/** الحقول المالية والحسّاسة تُخفى عمّن لا يملك صلاحية الاطلاع عليها. */
const SENSITIVE = ['basic_salary', 'housing_allowance', 'transport_allowance', 'other_allowance',
  'bank_name', 'iban', 'national_id'];

function maskSensitive(row) {
  const copy = { ...row };
  SENSITIVE.forEach((field) => { delete copy[field]; });
  return copy;
}

/** هل يحق للمستخدم رؤية الملف كاملاً (بما فيه الراتب)؟ */
function canSeeFull(user, employeeId) {
  return user.id === Number(employeeId)
    || ['admin', 'hr', 'finance'].includes(user.role);
}

const EDITABLE_BY_SELF = ['phone', 'address', 'emergency_contact', 'emergency_phone', 'marital_status'];

const EDITABLE_BY_HR = [
  'employee_no', 'national_id', 'full_name_ar', 'full_name_en', 'email', 'phone', 'role',
  'job_title', 'department_id', 'manager_id', 'hire_date', 'contract_type', 'status',
  'nationality', 'gender', 'birth_date', 'marital_status', 'address', 'emergency_contact',
  'emergency_phone', 'iqama_expiry', 'gosi_join_date', 'license_no', 'license_expiry', 'basic_salary',
  'housing_allowance', 'transport_allowance', 'other_allowance', 'bank_name', 'iban',
  'annual_leave_balance',
];

// قائمة الموظفين (مع بحث وتصفية وترقيم صفحات)
router.get('/', requirePermission('employees:read'), asyncHandler(async (req, res) => {
  const { q, department_id: deptId, status, role, manager_id: managerId } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 25));

  const where = [];
  const params = [];

  // المدير المباشر يرى فريقه فقط، ما لم يكن من الإدارات المركزية
  if (req.user.role === 'manager') {
    where.push('(e.manager_id = ? OR e.id = ?)');
    params.push(req.user.id, req.user.id);
  }

  if (q) {
    where.push(`(e.full_name_ar LIKE ? OR e.full_name_en LIKE ? OR e.email LIKE ?
                 OR e.employee_no LIKE ? OR e.job_title LIKE ? OR e.phone LIKE ?)`);
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like);
  }
  if (deptId) { where.push('e.department_id = ?'); params.push(Number(deptId)); }
  if (status) { where.push('e.status = ?'); params.push(status); }
  if (role) { where.push('e.role = ?'); params.push(role); }
  if (managerId) { where.push('e.manager_id = ?'); params.push(Number(managerId)); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.get(`SELECT COUNT(*) AS n FROM employees e ${whereSql}`, params).n;

  const rows = db.all(
    `${SELECT_BASE} ${whereSql} ORDER BY e.full_name_ar LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit],
  );

  const full = ['admin', 'hr', 'finance'].includes(req.user.role);
  res.json({
    data: full ? rows : rows.map(maskSensitive),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
  });
}));

// قائمة مبسّطة للاستخدام في القوائم المنسدلة
router.get('/lookup', asyncHandler(async (req, res) => {
  const rows = db.all(
    `SELECT id, employee_no, full_name_ar, job_title, department_id, role
       FROM employees WHERE status = 'active' ORDER BY full_name_ar`,
  );
  res.json({ data: rows });
}));

// الهيكل التنظيمي
router.get('/org-chart', asyncHandler(async (req, res) => {
  const rows = db.all(
    `SELECT e.id, e.full_name_ar, e.job_title, e.manager_id, e.avatar, d.name_ar AS department_name
       FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.status = 'active'
      ORDER BY e.full_name_ar`,
  );

  const byId = new Map(rows.map((r) => [r.id, { ...r, reports: [] }]));
  const roots = [];
  byId.forEach((node) => {
    const parent = node.manager_id ? byId.get(node.manager_id) : null;
    if (parent && parent.id !== node.id) parent.reports.push(node);
    else roots.push(node);
  });

  res.json({ data: roots });
}));

// بطاقة موظف
router.get('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const isSelf = id === req.user.id;

  if (!isSelf && !isPrivileged(req.user.role)) throw forbidden();

  const row = db.get(`${SELECT_BASE} WHERE e.id = ?`, [id]);
  if (!row) throw notFound('الموظف غير موجود');

  if (req.user.role === 'manager' && !isSelf && row.manager_id !== req.user.id) {
    throw forbidden('يمكنك الاطلاع على بيانات فريقك فقط');
  }

  const payload = canSeeFull(req.user, id) ? row : maskSensitive(row);
  payload.direct_reports = db.all(
    'SELECT id, full_name_ar, job_title FROM employees WHERE manager_id = ? AND status = \'active\'',
    [id],
  );

  res.json({ data: payload });
}));

// إضافة موظف
router.post('/', requirePermission('employees:create'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  const required = ['full_name_ar', 'email'];
  const missing = required.filter((field) => !String(body[field] || '').trim());
  if (missing.length) throw badRequest('الاسم والبريد الإلكتروني حقول إلزامية');

  const email = String(body.email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('صيغة البريد الإلكتروني غير صحيحة');
  if (db.get('SELECT id FROM employees WHERE lower(email) = ?', [email])) {
    throw conflict('البريد الإلكتروني مستخدم لموظف آخر');
  }

  const role = ROLE_KEYS.includes(body.role) ? body.role : 'employee';
  if (role === 'admin' && req.user.role !== 'admin') throw forbidden('إنشاء حساب مدير نظام يتطلب صلاحية مدير النظام');

  let employeeNo = String(body.employee_no || '').trim();
  if (!employeeNo) {
    const last = db.get("SELECT MAX(CAST(employee_no AS INTEGER)) AS n FROM employees WHERE employee_no GLOB '[0-9]*'");
    employeeNo = String((last && last.n ? last.n : 1000) + 1);
  }
  if (db.get('SELECT id FROM employees WHERE employee_no = ?', [employeeNo])) {
    throw conflict('الرقم الوظيفي مستخدم مسبقاً');
  }

  if (body.hire_date && !isValidDate(body.hire_date)) throw badRequest('تاريخ التعيين غير صالح');

  const tempPassword = String(body.password || '').trim() || generateTempPassword();

  const info = db.run(
    `INSERT INTO employees (
        employee_no, national_id, full_name_ar, full_name_en, email, phone, password_hash,
        must_change_password, role, job_title, department_id, manager_id, hire_date,
        contract_type, status, nationality, gender, birth_date, address, emergency_contact,
        emergency_phone, iqama_expiry, license_no, license_expiry, basic_salary,
        housing_allowance, transport_allowance, other_allowance, bank_name, iban,
        annual_leave_balance)
     VALUES (?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      employeeNo, body.national_id || null, body.full_name_ar, body.full_name_en || null, email,
      body.phone || null, hashPassword(tempPassword), role, body.job_title || null,
      body.department_id ? Number(body.department_id) : null,
      body.manager_id ? Number(body.manager_id) : null,
      body.hire_date || null, body.contract_type || 'دوام كامل', body.status || 'active',
      body.nationality || null, body.gender || null, body.birth_date || null,
      body.address || null, body.emergency_contact || null, body.emergency_phone || null,
      body.iqama_expiry || null, body.license_no || null, body.license_expiry || null,
      Number(body.basic_salary) || 0, Number(body.housing_allowance) || 0,
      Number(body.transport_allowance) || 0, Number(body.other_allowance) || 0,
      body.bank_name || null, body.iban || null,
      body.annual_leave_balance !== undefined ? Number(body.annual_leave_balance) : 21,
    ],
  );

  const id = Number(info.lastInsertRowid);
  audit.log(req, 'create', 'employees', id, { employee_no: employeeNo, email });
  hooks.emit('employee.created', {
    employee_no: employeeNo, full_name_ar: body.full_name_ar, email,
    job_title: body.job_title || null, role,
  });

  res.status(201).json({
    data: db.get(`${SELECT_BASE} WHERE e.id = ?`, [id]),
    temp_password: tempPassword,
    message: 'تم إنشاء الموظف. سلّم كلمة المرور المؤقتة للموظف وسيُطلب منه تغييرها عند أول دخول.',
  });
}));

// تعديل بيانات موظف
router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = db.get('SELECT * FROM employees WHERE id = ?', [id]);
  if (!existing) throw notFound('الموظف غير موجود');

  const isSelf = id === req.user.id;
  const hrLike = ['admin', 'hr'].includes(req.user.role);
  if (!isSelf && !hrLike) throw forbidden();

  const allowed = hrLike ? EDITABLE_BY_HR : EDITABLE_BY_SELF;
  const body = req.body || {};
  const updates = [];
  const params = [];

  allowed.forEach((field) => {
    if (!(field in body)) return;
    let value = body[field];

    if (field === 'role') {
      if (!ROLE_KEYS.includes(value)) throw badRequest('الدور المحدد غير معروف');
      if (value === 'admin' && req.user.role !== 'admin') throw forbidden('ترقية الحساب لمدير نظام تتطلب صلاحية مدير النظام');
      if (isSelf && value !== existing.role) throw forbidden('لا يمكنك تغيير دورك بنفسك');
    }
    if (field === 'email') {
      value = String(value).trim().toLowerCase();
      const clash = db.get('SELECT id FROM employees WHERE lower(email) = ? AND id <> ?', [value, id]);
      if (clash) throw conflict('البريد الإلكتروني مستخدم لموظف آخر');
    }
    if (field === 'manager_id') {
      value = value ? Number(value) : null;
      if (value === id) throw badRequest('لا يمكن أن يكون الموظف مديراً لنفسه');
    }
    if (['basic_salary', 'housing_allowance', 'transport_allowance', 'other_allowance',
      'annual_leave_balance'].includes(field)) {
      value = Number(value) || 0;
    }
    if (['hire_date', 'birth_date', 'iqama_expiry', 'license_expiry'].includes(field)
        && value && !isValidDate(value)) {
      throw badRequest('صيغة أحد التواريخ غير صحيحة');
    }

    updates.push(`${field} = ?`);
    params.push(value === '' ? null : value);
  });

  if (!updates.length) throw badRequest('لا توجد حقول قابلة للتعديل في الطلب');

  db.run(
    `UPDATE employees SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`,
    [...params, id],
  );

  audit.log(req, 'update', 'employees', id, { fields: updates.map((u) => u.split(' =')[0]) });
  res.json({ data: db.get(`${SELECT_BASE} WHERE e.id = ?`, [id]), message: 'تم حفظ التعديلات' });
}));

// إعادة تعيين كلمة المرور
router.post('/:id/reset-password', requirePermission('employees:update'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const employee = db.get('SELECT id, full_name_ar FROM employees WHERE id = ?', [id]);
  if (!employee) throw notFound('الموظف غير موجود');

  const tempPassword = generateTempPassword();
  db.run(
    "UPDATE employees SET password_hash = ?, must_change_password = 1, updated_at = datetime('now') WHERE id = ?",
    [hashPassword(tempPassword), id],
  );

  audit.log(req, 'reset_password', 'employees', id);
  res.json({ temp_password: tempPassword, message: `تم إنشاء كلمة مرور مؤقتة لـ ${employee.full_name_ar}` });
}));

// إنهاء خدمة / أرشفة موظف
router.delete('/:id', requirePermission('employees:delete'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw badRequest('لا يمكنك أرشفة حسابك الخاص');

  const employee = db.get('SELECT id FROM employees WHERE id = ?', [id]);
  if (!employee) throw notFound('الموظف غير موجود');

  db.run("UPDATE employees SET status = 'terminated', updated_at = datetime('now') WHERE id = ?", [id]);
  audit.log(req, 'terminate', 'employees', id);
  hooks.emit('employee.terminated', {
    employee_no: db.get('SELECT employee_no FROM employees WHERE id = ?', [id]).employee_no,
  });

  res.json({ ok: true, message: 'تم إنهاء خدمة الموظف وأرشفة حسابه' });
}));

module.exports = router;
