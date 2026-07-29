'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler, badRequest, notFound, forbidden } = require('../utils/http');
const { requireAuth, requirePermission } = require('../middleware/auth');
const audit = require('../utils/audit');
const notify = require('../utils/notify');

const router = express.Router();
router.use(requireAuth);

const SELECT_BASE = `
  SELECT a.*, e.full_name_ar AS author_name, d.name_ar AS department_name
    FROM announcements a
    LEFT JOIN employees   e ON e.id = a.published_by
    LEFT JOIN departments d ON d.id = a.department_id`;

// الإعلانات المرئية للمستخدم (العامة + إعلانات قسمه)
router.get('/', asyncHandler(async (req, res) => {
  const rows = db.all(
    `${SELECT_BASE}
      WHERE (a.department_id IS NULL OR a.department_id = ?)
        AND (a.expires_at IS NULL OR a.expires_at >= date('now'))
      ORDER BY a.pinned DESC, a.published_at DESC
      LIMIT ?`,
    [req.user.department_id || -1, Math.min(100, Number(req.query.limit) || 50)],
  );
  res.json({ data: rows });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const row = db.get(`${SELECT_BASE} WHERE a.id = ?`, [Number(req.params.id)]);
  if (!row) throw notFound('الإعلان غير موجود');
  res.json({ data: row });
}));

router.post('/', requirePermission('announcements:create'), asyncHandler(async (req, res) => {
  const { title, body } = req.body || {};
  if (!String(title || '').trim() || !String(body || '').trim()) {
    throw badRequest('العنوان والمحتوى حقلان إلزاميان');
  }

  const departmentId = req.body.department_id ? Number(req.body.department_id) : null;
  const info = db.run(
    `INSERT INTO announcements (title, body, priority, department_id, pinned, published_by, expires_at)
     VALUES (?,?,?,?,?,?,?)`,
    [String(title).trim(), String(body).trim(),
      ['normal', 'high', 'urgent'].includes(req.body.priority) ? req.body.priority : 'normal',
      departmentId, req.body.pinned ? 1 : 0, req.user.id, req.body.expires_at || null],
  );

  const id = Number(info.lastInsertRowid);

  const audience = departmentId
    ? db.all("SELECT id FROM employees WHERE department_id = ? AND status = 'active'", [departmentId])
    : db.all("SELECT id FROM employees WHERE status = 'active'");
  notify.pushMany(audience.map((r) => r.id), 'إعلان جديد', String(title).trim(), '#/announcements');

  audit.log(req, 'create', 'announcements', id, { title });
  res.status(201).json({ data: db.get(`${SELECT_BASE} WHERE a.id = ?`, [id]), message: 'تم نشر الإعلان' });
}));

router.put('/:id', requirePermission('announcements:update'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = db.get('SELECT * FROM announcements WHERE id = ?', [id]);
  if (!existing) throw notFound('الإعلان غير موجود');
  if (req.user.role === 'manager' && existing.published_by !== req.user.id) {
    throw forbidden('يمكنك تعديل إعلاناتك فقط');
  }

  const fields = ['title', 'body', 'priority', 'department_id', 'pinned', 'expires_at'];
  const updates = [];
  const params = [];

  fields.forEach((field) => {
    if (!(field in req.body)) return;
    let value = req.body[field];
    if (field === 'pinned') value = value ? 1 : 0;
    if (field === 'department_id') value = value ? Number(value) : null;
    updates.push(`${field} = ?`);
    params.push(value === '' ? null : value);
  });

  if (!updates.length) throw badRequest('لا توجد حقول للتعديل');

  db.run(`UPDATE announcements SET ${updates.join(', ')} WHERE id = ?`, [...params, id]);
  audit.log(req, 'update', 'announcements', id);
  res.json({ data: db.get(`${SELECT_BASE} WHERE a.id = ?`, [id]), message: 'تم تحديث الإعلان' });
}));

router.delete('/:id', requirePermission('announcements:delete'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!db.get('SELECT id FROM announcements WHERE id = ?', [id])) throw notFound('الإعلان غير موجود');

  db.run('DELETE FROM announcements WHERE id = ?', [id]);
  audit.log(req, 'delete', 'announcements', id);
  res.json({ ok: true, message: 'تم حذف الإعلان' });
}));

module.exports = router;
