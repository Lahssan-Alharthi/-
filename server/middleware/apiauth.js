'use strict';

const db = require('../db');
const audit = require('../utils/audit');
const { extractKey, hashKey, hashesMatch } = require('../utils/apikey');
const { HttpError } = require('../utils/http');

/** نافذة معدّل الطلبات لكل مفتاح: طابع زمني ⇽ عدّاد. */
const windows = new Map();
const WINDOW_MS = 60 * 1000;

/** يتحقّق من عدم تجاوز المفتاح حدّه المسموح في الدقيقة. */
function withinRateLimit(keyId, limit) {
  const now = Date.now();
  const entry = windows.get(keyId);

  if (!entry || now - entry.start >= WINDOW_MS) {
    windows.set(keyId, { start: now, count: 1 });
    return { allowed: true, remaining: limit - 1, resetIn: Math.ceil(WINDOW_MS / 1000) };
  }

  entry.count += 1;
  const resetIn = Math.ceil((entry.start + WINDOW_MS - now) / 1000);
  return { allowed: entry.count <= limit, remaining: Math.max(0, limit - entry.count), resetIn };
}

/** يزيل النوافذ المنتهية دورياً حتى لا تنمو الذاكرة. */
setInterval(() => {
  const now = Date.now();
  windows.forEach((entry, id) => {
    if (now - entry.start >= WINDOW_MS * 2) windows.delete(id);
  });
}, WINDOW_MS).unref();

/**
 * يوثّق الطلب بمفتاح ربط ويحمّل بياناته في req.apiKey.
 * لا يقبل جلسات المستخدمين — هذا المسار مخصّص للأنظمة الخارجية.
 */
function requireApiKey(req, res, next) {
  const provided = extractKey(req);
  if (!provided) {
    return next(new HttpError(401, 'مفتاح الربط مطلوب في ترويسة Authorization: Bearer أو X-API-Key'));
  }

  const record = db.get('SELECT * FROM api_keys WHERE key_hash = ?', [hashKey(provided)]);
  if (!record || !hashesMatch(record.key_hash, hashKey(provided))) {
    return next(new HttpError(401, 'مفتاح الربط غير صالح'));
  }
  if (record.revoked_at) {
    return next(new HttpError(401, 'تم إلغاء هذا المفتاح'));
  }
  if (record.expires_at && record.expires_at < new Date().toISOString().slice(0, 10)) {
    return next(new HttpError(401, 'انتهت صلاحية هذا المفتاح'));
  }

  const limit = record.rate_limit || 600;
  const usage = withinRateLimit(record.id, limit);
  res.setHeader('X-RateLimit-Limit', limit);
  res.setHeader('X-RateLimit-Remaining', usage.remaining);
  res.setHeader('X-RateLimit-Reset', usage.resetIn);

  if (!usage.allowed) {
    res.setHeader('Retry-After', usage.resetIn);
    return next(new HttpError(429, `تجاوزت الحد المسموح (${limit} طلب في الدقيقة)، حاول بعد ${usage.resetIn} ثانية`));
  }

  const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
  db.run(
    `UPDATE api_keys SET last_used_at = datetime('now'), last_used_ip = ?,
            request_count = request_count + 1 WHERE id = ?`,
    [ip || null, record.id],
  );

  req.apiKey = {
    id: record.id,
    name: record.name,
    environment: record.environment,
    scopes: record.scopes ? record.scopes.split(',') : [],
  };

  return next();
}

/** يمنع المتابعة ما لم يملك المفتاح النطاق المطلوب. */
function requireScope(scope) {
  return (req, res, next) => {
    if (!req.apiKey) return next(new HttpError(401, 'مفتاح الربط مطلوب'));
    if (!req.apiKey.scopes.includes(scope)) {
      return next(new HttpError(403, `هذا المفتاح لا يملك نطاق الوصول المطلوب: ${scope}`));
    }
    return next();
  };
}

/** يسجّل عملية كتابة نفّذها نظام خارجي في سجل النشاط. */
function logApiWrite(req, action, entity, entityId, details) {
  audit.log(req, `api:${action}`, entity, entityId, {
    api_key: req.apiKey ? req.apiKey.name : null,
    ...(details || {}),
  });
}

module.exports = { requireApiKey, requireScope, logApiWrite };
