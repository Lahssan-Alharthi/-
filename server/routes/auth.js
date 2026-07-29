'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler, badRequest, unauthorized } = require('../utils/http');
const { hashPassword, verifyPassword, checkStrength } = require('../utils/password');
const { issueToken, clearToken, requireAuth } = require('../middleware/auth');
const { ROLES } = require('../utils/rbac');
const audit = require('../utils/audit');
const { nowStamp } = require('../utils/dates');

const router = express.Router();

/** محاولات دخول فاشلة لكل بريد، للحد من التخمين. */
const attempts = new Map();
const MAX_ATTEMPTS = 8;
const LOCK_MS = 10 * 60 * 1000;

function registerFailure(key) {
  const entry = attempts.get(key) || { count: 0, until: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.until = Date.now() + LOCK_MS;
    entry.count = 0;
  }
  attempts.set(key, entry);
}

function isLocked(key) {
  const entry = attempts.get(key);
  return Boolean(entry && entry.until > Date.now());
}

function publicUser(row) {
  return {
    id: row.id,
    employee_no: row.employee_no,
    full_name_ar: row.full_name_ar,
    full_name_en: row.full_name_en,
    email: row.email,
    role: row.role,
    role_label: ROLES[row.role] ? ROLES[row.role].label : row.role,
    job_title: row.job_title,
    department_id: row.department_id,
    department_name: row.department_name,
    manager_id: row.manager_id,
    avatar: row.avatar,
    must_change_password: Boolean(row.must_change_password),
    permissions: ROLES[row.role] ? ROLES[row.role].permissions : [],
  };
}

// تسجيل الدخول
router.post('/login', asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!email || !password) throw badRequest('يرجى إدخال البريد الإلكتروني وكلمة المرور');
  if (isLocked(email)) {
    throw badRequest('تم إيقاف المحاولات مؤقتاً بسبب تكرار الأخطاء، حاول بعد 10 دقائق');
  }

  const row = db.get(
    `SELECT e.*, d.name_ar AS department_name
       FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id
      WHERE lower(e.email) = ?`,
    [email],
  );

  if (!row || !verifyPassword(password, row.password_hash)) {
    registerFailure(email);
    throw unauthorized('البريد الإلكتروني أو كلمة المرور غير صحيحة');
  }

  if (row.status !== 'active') {
    throw unauthorized('الحساب غير مفعّل، يرجى مراجعة إدارة الموارد البشرية');
  }

  attempts.delete(email);
  db.run('UPDATE employees SET last_login_at = ? WHERE id = ?', [nowStamp(), row.id]);
  issueToken(res, row);

  req.user = row;
  audit.log(req, 'login', 'employees', row.id);

  res.json({ user: publicUser(row) });
}));

// تسجيل الخروج
router.post('/logout', asyncHandler(async (req, res) => {
  clearToken(res);
  res.json({ ok: true });
}));

// بيانات المستخدم الحالي
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ user: publicUser(req.user) });
}));

// تغيير كلمة المرور
router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const current = String(req.body.current_password || '');
  const next = String(req.body.new_password || '');

  const row = db.get('SELECT password_hash FROM employees WHERE id = ?', [req.user.id]);
  if (!verifyPassword(current, row.password_hash)) {
    throw badRequest('كلمة المرور الحالية غير صحيحة');
  }

  const weakness = checkStrength(next);
  if (weakness) throw badRequest(weakness);
  if (current === next) throw badRequest('كلمة المرور الجديدة يجب أن تختلف عن الحالية');

  db.run(
    "UPDATE employees SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?",
    [hashPassword(next), req.user.id],
  );

  audit.log(req, 'change_password', 'employees', req.user.id);
  res.json({ ok: true, message: 'تم تحديث كلمة المرور بنجاح' });
}));

module.exports = { router, publicUser };
