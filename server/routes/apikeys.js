'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler, badRequest, notFound, conflict } = require('../utils/http');
const { requireAuth, requireRole } = require('../middleware/auth');
const { SCOPES, generateKey, normalizeScopes } = require('../utils/apikey');
const { isValidDate } = require('../utils/dates');
const audit = require('../utils/audit');

const router = express.Router();

// إدارة مفاتيح الربط مقصورة على مدير النظام
router.use(requireAuth, requireRole('admin'));

const SELECT_BASE = `
  SELECT k.id, k.name, k.description, k.environment, k.key_prefix, k.scopes, k.rate_limit,
         k.created_at, k.expires_at, k.last_used_at, k.last_used_ip, k.request_count,
         k.revoked_at,
         c.full_name_ar AS created_by_name,
         r.full_name_ar AS revoked_by_name
    FROM api_keys k
    LEFT JOIN employees c ON c.id = k.created_by
    LEFT JOIN employees r ON r.id = k.revoked_by`;

function present(row) {
  return {
    ...row,
    scopes: row.scopes ? row.scopes.split(',') : [],
    status: row.revoked_at ? 'revoked'
      : (row.expires_at && row.expires_at < new Date().toISOString().slice(0, 10) ? 'expired' : 'active'),
  };
}

// النطاقات المتاحة
router.get('/scopes', asyncHandler(async (req, res) => {
  res.json({ data: SCOPES });
}));

router.get('/', asyncHandler(async (req, res) => {
  res.json({ data: db.all(`${SELECT_BASE} ORDER BY k.created_at DESC`).map(present) });
}));

/**
 * إنشاء مفتاح جديد. المفتاح الكامل يُعاد مرة واحدة فقط في هذه الاستجابة
 * ولا يمكن استرجاعه بعدها، إذ لا يُخزَّن منه إلا تلبيدته.
 */
router.post('/', asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw badRequest('اسم المفتاح إلزامي');
  if (db.get('SELECT id FROM api_keys WHERE name = ? AND revoked_at IS NULL', [name])) {
    throw conflict('يوجد مفتاح فعّال بهذا الاسم');
  }

  const scopes = normalizeScopes(req.body.scopes);
  if (!scopes.length) throw badRequest('يجب تحديد نطاق وصول واحد على الأقل');

  if (req.body.expires_at && !isValidDate(req.body.expires_at)) {
    throw badRequest('تاريخ انتهاء الصلاحية غير صالح');
  }

  const rateLimit = req.body.rate_limit ? Number(req.body.rate_limit) : 600;
  if (!Number.isInteger(rateLimit) || rateLimit < 1 || rateLimit > 60000) {
    throw badRequest('حد الطلبات يجب أن يكون بين 1 و 60000 طلب في الدقيقة');
  }

  const generated = generateKey(req.body.environment);
  const info = db.run(
    `INSERT INTO api_keys (name, description, environment, key_prefix, key_hash, scopes,
            rate_limit, created_by, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [name, req.body.description || null, generated.key.split('_')[1], generated.prefix,
      generated.hash, scopes.join(','), rateLimit, req.user.id, req.body.expires_at || null],
  );

  const id = Number(info.lastInsertRowid);
  audit.log(req, 'create', 'api_keys', id, { name, scopes });

  res.status(201).json({
    data: present(db.get(`${SELECT_BASE} WHERE k.id = ?`, [id])),
    api_key: generated.key,
    message: 'انسخ المفتاح الآن — لن يُعرض مرة أخرى.',
  });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = db.get('SELECT * FROM api_keys WHERE id = ?', [id]);
  if (!existing) throw notFound('المفتاح غير موجود');
  if (existing.revoked_at) throw conflict('لا يمكن تعديل مفتاح ملغى');

  const updates = [];
  const params = [];

  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) throw badRequest('اسم المفتاح إلزامي');
    updates.push('name = ?');
    params.push(name);
  }
  if (req.body.description !== undefined) {
    updates.push('description = ?');
    params.push(req.body.description || null);
  }
  if (req.body.scopes !== undefined) {
    const scopes = normalizeScopes(req.body.scopes);
    if (!scopes.length) throw badRequest('يجب تحديد نطاق وصول واحد على الأقل');
    updates.push('scopes = ?');
    params.push(scopes.join(','));
  }
  if (req.body.rate_limit !== undefined) {
    const rateLimit = Number(req.body.rate_limit);
    if (!Number.isInteger(rateLimit) || rateLimit < 1 || rateLimit > 60000) {
      throw badRequest('حد الطلبات يجب أن يكون بين 1 و 60000 طلب في الدقيقة');
    }
    updates.push('rate_limit = ?');
    params.push(rateLimit);
  }
  if (req.body.expires_at !== undefined) {
    if (req.body.expires_at && !isValidDate(req.body.expires_at)) {
      throw badRequest('تاريخ انتهاء الصلاحية غير صالح');
    }
    updates.push('expires_at = ?');
    params.push(req.body.expires_at || null);
  }

  if (!updates.length) throw badRequest('لا توجد حقول للتعديل');

  db.run(`UPDATE api_keys SET ${updates.join(', ')} WHERE id = ?`, [...params, id]);
  audit.log(req, 'update', 'api_keys', id);

  res.json({ data: present(db.get(`${SELECT_BASE} WHERE k.id = ?`, [id])), message: 'تم حفظ التعديلات' });
}));

/** إلغاء المفتاح — لا يُحذف السجل حتى يبقى أثره في المراجعة. */
router.post('/:id/revoke', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = db.get('SELECT * FROM api_keys WHERE id = ?', [id]);
  if (!existing) throw notFound('المفتاح غير موجود');
  if (existing.revoked_at) throw conflict('المفتاح ملغى مسبقاً');

  db.run("UPDATE api_keys SET revoked_at = datetime('now'), revoked_by = ? WHERE id = ?",
    [req.user.id, id]);
  audit.log(req, 'revoke', 'api_keys', id, { name: existing.name });

  res.json({ ok: true, message: `تم إلغاء المفتاح «${existing.name}» ولن يُقبل في أي طلب لاحق` });
}));

module.exports = router;
