'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler, badRequest, notFound, conflict } = require('../utils/http');
const { requireAuth, requireRole } = require('../middleware/auth');
const hooks = require('../utils/webhooks');
const audit = require('../utils/audit');

const router = express.Router();

// إدارة اشتراكات الأحداث مقصورة على مدير النظام
router.use(requireAuth, requireRole('admin'));

const SELECT_BASE = `
  SELECT w.id, w.name, w.url, w.events, w.is_active, w.created_at, w.last_delivery_at,
         w.last_status, w.failure_streak, w.disabled_at, w.disabled_reason,
         e.full_name_ar AS created_by_name,
         (SELECT COUNT(*) FROM webhook_deliveries d WHERE d.webhook_id = w.id) AS deliveries_count
    FROM webhooks w
    LEFT JOIN employees e ON e.id = w.created_by`;

function present(row) {
  return { ...row, events: hooks.normalizeEvents(row.events), is_active: Boolean(row.is_active) };
}

router.get('/events', asyncHandler(async (req, res) => {
  res.json({ data: hooks.EVENTS });
}));

router.get('/', asyncHandler(async (req, res) => {
  res.json({ data: db.all(`${SELECT_BASE} ORDER BY w.created_at DESC`).map(present) });
}));

// سجل محاولات التسليم لاشتراك معيّن
router.get('/:id/deliveries', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!db.get('SELECT id FROM webhooks WHERE id = ?', [id])) throw notFound('الاشتراك غير موجود');

  res.json({
    data: db.all(
      `SELECT id, event, attempt, status_code, error, duration_ms, created_at
         FROM webhook_deliveries WHERE webhook_id = ?
        ORDER BY created_at DESC LIMIT 100`,
      [id],
    ),
  });
}));

/** إنشاء اشتراك. السر يُعاد مرة واحدة فقط للتحقّق من التوقيع. */
router.post('/', asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const url = String(req.body.url || '').trim();

  if (!name) throw badRequest('اسم الاشتراك إلزامي');

  const urlError = hooks.validateUrl(url);
  if (urlError) throw badRequest(urlError);

  const events = hooks.normalizeEvents(req.body.events);
  if (!events.length) throw badRequest('يجب اختيار حدث واحد على الأقل');

  if (db.get('SELECT id FROM webhooks WHERE name = ?', [name])) {
    throw conflict('يوجد اشتراك بهذا الاسم');
  }

  const secret = hooks.generateSecret();
  const info = db.run(
    'INSERT INTO webhooks (name, url, secret, events, created_by) VALUES (?,?,?,?,?)',
    [name, url, secret, events.join(','), req.user.id],
  );

  const id = Number(info.lastInsertRowid);
  audit.log(req, 'create', 'webhooks', id, { name, url, events });

  res.status(201).json({
    data: present(db.get(`${SELECT_BASE} WHERE w.id = ?`, [id])),
    secret,
    message: 'انسخ السر الآن — يُستخدم للتحقّق من توقيع الأحداث ولن يُعرض مرة أخرى.',
  });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!db.get('SELECT id FROM webhooks WHERE id = ?', [id])) throw notFound('الاشتراك غير موجود');

  const updates = [];
  const params = [];

  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) throw badRequest('اسم الاشتراك إلزامي');
    updates.push('name = ?'); params.push(name);
  }
  if (req.body.url !== undefined) {
    const urlError = hooks.validateUrl(String(req.body.url).trim());
    if (urlError) throw badRequest(urlError);
    updates.push('url = ?'); params.push(String(req.body.url).trim());
  }
  if (req.body.events !== undefined) {
    const events = hooks.normalizeEvents(req.body.events);
    if (!events.length) throw badRequest('يجب اختيار حدث واحد على الأقل');
    updates.push('events = ?'); params.push(events.join(','));
  }
  if (req.body.is_active !== undefined) {
    const active = req.body.is_active ? 1 : 0;
    updates.push('is_active = ?'); params.push(active);
    // إعادة التنشيط تصفّر عدّاد الأعطال وسبب الإيقاف
    if (active) {
      updates.push('failure_streak = 0', 'disabled_at = NULL', 'disabled_reason = NULL');
    }
  }

  if (!updates.length) throw badRequest('لا توجد حقول للتعديل');

  db.run(`UPDATE webhooks SET ${updates.join(', ')} WHERE id = ?`, [...params, id]);
  audit.log(req, 'update', 'webhooks', id);

  res.json({ data: present(db.get(`${SELECT_BASE} WHERE w.id = ?`, [id])), message: 'تم حفظ التعديلات' });
}));

/** إرسال حدث تجريبي للتأكّد من صحة الرابط والتوقيع. */
router.post('/:id/test', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const webhook = db.get('SELECT * FROM webhooks WHERE id = ?', [id]);
  if (!webhook) throw notFound('الاشتراك غير موجود');

  const event = hooks.EVENT_KEYS.includes(req.body.event) ? req.body.event : 'attendance.recorded';
  const body = JSON.stringify({
    event,
    sent_at: new Date().toISOString(),
    test: true,
    data: { message: 'هذا حدث تجريبي من بوابة موظفي شركة مدد للخدمات اللوجستية' },
  });

  const result = await hooks.deliver(webhook, event, body, 1);
  audit.log(req, 'test', 'webhooks', id, { event, ok: result.ok });

  res.json({
    ok: result.ok,
    status_code: result.status,
    duration_ms: result.duration,
    error: result.error,
    message: result.ok
      ? `تم التسليم بنجاح (${result.status}) في ${result.duration} مللي ثانية`
      : `تعذّر التسليم: ${result.error}`,
  });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const webhook = db.get('SELECT name FROM webhooks WHERE id = ?', [id]);
  if (!webhook) throw notFound('الاشتراك غير موجود');

  db.run('DELETE FROM webhooks WHERE id = ?', [id]);
  audit.log(req, 'delete', 'webhooks', id, { name: webhook.name });

  res.json({ ok: true, message: `تم حذف الاشتراك «${webhook.name}»` });
}));

module.exports = router;
