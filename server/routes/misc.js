'use strict';

const express = require('express');
const db = require('../db');
const config = require('../config');
const { asyncHandler, badRequest, notFound } = require('../utils/http');
const { requireAuth, requirePermission, requireRole } = require('../middleware/auth');
const { ROLES } = require('../utils/rbac');
const audit = require('../utils/audit');

const notifications = express.Router();
notifications.use(requireAuth);

notifications.get('/', asyncHandler(async (req, res) => {
  const rows = db.all(
    'SELECT * FROM notifications WHERE employee_id = ? ORDER BY created_at DESC LIMIT 50',
    [req.user.id],
  );
  const unread = db.get(
    'SELECT COUNT(*) AS n FROM notifications WHERE employee_id = ? AND is_read = 0',
    [req.user.id],
  ).n;

  res.json({ data: rows, unread });
}));

notifications.post('/:id/read', asyncHandler(async (req, res) => {
  db.run('UPDATE notifications SET is_read = 1 WHERE id = ? AND employee_id = ?',
    [Number(req.params.id), req.user.id]);
  res.json({ ok: true });
}));

notifications.post('/read-all', asyncHandler(async (req, res) => {
  db.run('UPDATE notifications SET is_read = 1 WHERE employee_id = ?', [req.user.id]);
  res.json({ ok: true, message: 'تم تعليم كل الإشعارات كمقروءة' });
}));

notifications.delete('/:id', asyncHandler(async (req, res) => {
  db.run('DELETE FROM notifications WHERE id = ? AND employee_id = ?',
    [Number(req.params.id), req.user.id]);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------

const auditRouter = express.Router();
auditRouter.use(requireAuth, requireRole('admin'));

auditRouter.get('/', asyncHandler(async (req, res) => {
  const where = [];
  const params = [];

  if (req.query.actor_id) { where.push('a.actor_id = ?'); params.push(Number(req.query.actor_id)); }
  if (req.query.entity) { where.push('a.entity = ?'); params.push(req.query.entity); }
  if (req.query.action) { where.push('a.action = ?'); params.push(req.query.action); }
  if (req.query.from) { where.push('date(a.created_at) >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('date(a.created_at) <= ?'); params.push(req.query.to); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));

  res.json({
    data: db.all(
      `SELECT a.*, e.full_name_ar AS actor_name, e.employee_no
         FROM audit_logs a LEFT JOIN employees e ON e.id = a.actor_id
         ${whereSql} ORDER BY a.created_at DESC LIMIT ?`,
      [...params, limit],
    ),
  });
}));

// ---------------------------------------------------------------------------

const settings = express.Router();
settings.use(requireAuth);

const PUBLIC_KEYS = new Set(['company.name_ar', 'company.name_en', 'company.logo_text',
  'work.start_time', 'work.end_time', 'work.grace_minutes']);

settings.get('/', asyncHandler(async (req, res) => {
  const rows = db.all('SELECT key, value FROM settings ORDER BY key');
  const isAdmin = req.user.role === 'admin';
  const visible = isAdmin ? rows : rows.filter((r) => PUBLIC_KEYS.has(r.key));

  res.json({
    data: Object.fromEntries(visible.map((r) => [r.key, r.value])),
    meta: { company: config.company, roles: ROLES },
  });
}));

settings.put('/', requirePermission('settings:update'), asyncHandler(async (req, res) => {
  const entries = Object.entries(req.body || {});
  if (!entries.length) throw badRequest('لا توجد إعدادات للحفظ');

  db.transaction(() => {
    entries.forEach(([key, value]) => {
      db.run(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
        [String(key), value === null ? null : String(value)],
      );
    });
  });

  audit.log(req, 'update', 'settings', null, { keys: entries.map(([k]) => k) });
  res.json({ ok: true, message: 'تم حفظ الإعدادات' });
}));

// أنواع الإجازات (إدارة)
settings.post('/leave-types', requirePermission('settings:update'), asyncHandler(async (req, res) => {
  const { code, name_ar: nameAr } = req.body || {};
  if (!String(code || '').trim() || !String(nameAr || '').trim()) {
    throw badRequest('رمز نوع الإجازة واسمه حقلان إلزاميان');
  }

  db.run(
    `INSERT INTO leave_types (code, name_ar, max_days, paid, deducts_balance, requires_attachment)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(code) DO UPDATE SET name_ar = excluded.name_ar, max_days = excluded.max_days,
        paid = excluded.paid, deducts_balance = excluded.deducts_balance,
        requires_attachment = excluded.requires_attachment`,
    [String(code).trim(), String(nameAr).trim(),
      req.body.max_days ? Number(req.body.max_days) : null,
      req.body.paid === false ? 0 : 1,
      req.body.deducts_balance === false ? 0 : 1,
      req.body.requires_attachment ? 1 : 0],
  );

  audit.log(req, 'upsert', 'leave_types', null, { code });
  res.json({ data: db.all('SELECT * FROM leave_types ORDER BY id'), message: 'تم حفظ نوع الإجازة' });
}));

settings.delete('/leave-types/:id', requirePermission('settings:update'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!db.get('SELECT id FROM leave_types WHERE id = ?', [id])) throw notFound('النوع غير موجود');

  const used = db.get('SELECT COUNT(*) AS n FROM leaves WHERE leave_type_id = ?', [id]).n;
  if (used > 0) throw badRequest('لا يمكن حذف نوع مرتبط بطلبات إجازة قائمة');

  db.run('DELETE FROM leave_types WHERE id = ?', [id]);
  audit.log(req, 'delete', 'leave_types', id);
  res.json({ ok: true, message: 'تم حذف نوع الإجازة' });
}));

module.exports = { notifications, audit: auditRouter, settings };
