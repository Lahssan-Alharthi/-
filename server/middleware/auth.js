'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { can } = require('../utils/rbac');
const { unauthorized, forbidden } = require('../utils/http');

/** يستخرج الرمز من الكوكي أو من ترويسة Authorization. */
function extractToken(req) {
  if (req.cookies && req.cookies[config.cookieName]) return req.cookies[config.cookieName];

  const header = req.get('authorization');
  if (header && header.startsWith('Bearer ')) return header.slice(7);

  return null;
}

/** يصدر رمز الدخول ويضعه في كوكي HttpOnly. */
function issueToken(res, employee) {
  const token = jwt.sign(
    { sub: employee.id, role: employee.role, no: employee.employee_no },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );

  res.cookie(config.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production',
    maxAge: 12 * 60 * 60 * 1000,
  });

  return token;
}

function clearToken(res) {
  res.clearCookie(config.cookieName);
}

/** يتحقّق من الجلسة ويحمّل بيانات الموظف في req.user. */
function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return next(unauthorized());

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return next(unauthorized('انتهت صلاحية الجلسة، يرجى تسجيل الدخول من جديد'));
  }

  const user = db.get(
    `SELECT e.id, e.employee_no, e.full_name_ar, e.full_name_en, e.email, e.role, e.status,
            e.job_title, e.department_id, e.manager_id, e.avatar, e.must_change_password,
            d.name_ar AS department_name
       FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id
      WHERE e.id = ?`,
    [payload.sub],
  );

  if (!user) return next(unauthorized('الحساب غير موجود'));
  if (user.status !== 'active') return next(forbidden('الحساب غير مفعّل، يرجى مراجعة الموارد البشرية'));

  req.user = user;
  return next();
}

/** يمنع المتابعة ما لم يملك المستخدم الصلاحية المطلوبة. */
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!can(req.user.role, permission)) return next(forbidden());
    return next();
  };
}

/** يمنع المتابعة ما لم يكن دور المستخدم ضمن القائمة. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    return next();
  };
}

module.exports = { issueToken, clearToken, requireAuth, requirePermission, requireRole };
