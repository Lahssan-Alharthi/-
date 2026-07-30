'use strict';

/**
 * دفع الأحداث إلى الأنظمة الخارجية.
 *
 * تُرسل الأحداث بعد نجاح العملية في قاعدة البيانات، ولا تُعيق الاستجابة
 * للمستخدم — الإرسال يجري في الخلفية بإعادة محاولة متدرّجة. كل طلب موقّع
 * بترويسة HMAC-SHA256 يتحقّق منها النظام المستقبِل.
 */

const crypto = require('crypto');
const db = require('../db');
const config = require('../config');

/** الأحداث التي يمكن الاشتراك فيها. */
const EVENTS = {
  'employee.created': 'إضافة موظف جديد',
  'employee.terminated': 'إنهاء خدمة موظف',
  'attendance.recorded': 'تسجيل حضور أو انصراف',
  'leave.requested': 'تقديم طلب إجازة',
  'leave.decided': 'اعتماد أو رفض إجازة',
  'request.decided': 'البتّ في طلب خدمة',
  'payroll.approved': 'اعتماد مسيّر رواتب',
  'trip.created': 'إنشاء رحلة',
  'trip.status_changed': 'تغيّر حالة رحلة',
  'vehicle.maintenance': 'تسجيل صيانة مركبة',
  'loan.created': 'تسجيل سلفة على الراتب',
  'end_of_service.approved': 'اعتماد مخالصة نهاية خدمة',
};

const EVENT_KEYS = Object.keys(EVENTS);

const MAX_ATTEMPTS = 4;
const BACKOFF_MS = [0, 5000, 30000, 120000];
const TIMEOUT_MS = 10000;
const MAX_FAILURE_STREAK = 10;

/** مؤقّتات المحاولات الجارية — تُلغى عند إيقاف الخادم. */
const timers = new Set();

function normalizeEvents(input) {
  const list = Array.isArray(input) ? input : String(input || '').split(',');
  return [...new Set(list.map((e) => String(e).trim()).filter((e) => EVENT_KEYS.includes(e)))];
}

function generateSecret() {
  return `whsec_${crypto.randomBytes(24).toString('base64url')}`;
}

/** توقيع الحمولة: HMAC-SHA256 على "الطابع الزمني.الحمولة". */
function sign(secret, timestamp, body) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/**
 * يمنع توجيه الـ webhook إلى عناوين داخلية في بيئة الإنتاج (حماية من SSRF).
 * يُسمح بها في التطوير والاختبار لتجربة الربط محلياً.
 */
function validateUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return 'صيغة الرابط غير صحيحة';
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return 'يجب أن يبدأ الرابط بـ http أو https';
  }
  if (config.env === 'production' && parsed.protocol !== 'https:') {
    return 'يجب استخدام HTTPS في بيئة الإنتاج';
  }

  const host = parsed.hostname.toLowerCase();
  const isPrivate = host === 'localhost' || host === '::1'
    || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^169\.254\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host);

  if (isPrivate && config.env === 'production') {
    return 'لا يُسمح بعناوين الشبكة الداخلية في بيئة الإنتاج';
  }

  return null;
}

/** يسجّل محاولة تسليم ويحدّث حالة الاشتراك. */
function recordDelivery(webhook, event, body, attempt, result) {
  db.run(
    `INSERT INTO webhook_deliveries (webhook_id, event, payload, attempt, status_code, error, duration_ms)
     VALUES (?,?,?,?,?,?,?)`,
    [webhook.id, event, body.slice(0, 4000), attempt,
      result.status || null, result.error ? String(result.error).slice(0, 500) : null,
      result.duration],
  );

  if (result.ok) {
    db.run(
      `UPDATE webhooks SET last_delivery_at = datetime('now'), last_status = ?, failure_streak = 0
        WHERE id = ?`,
      [result.status, webhook.id],
    );
    return;
  }

  const streak = db.get('SELECT failure_streak FROM webhooks WHERE id = ?', [webhook.id]);
  const next = (streak ? streak.failure_streak : 0) + 1;

  // الاشتراك المتعطّل باستمرار يُوقف تلقائياً حتى لا يستهلك الموارد بلا فائدة
  if (next >= MAX_FAILURE_STREAK) {
    db.run(
      `UPDATE webhooks SET last_delivery_at = datetime('now'), last_status = ?, failure_streak = ?,
              is_active = 0, disabled_at = datetime('now'),
              disabled_reason = 'تعطّل التسليم ' || ? || ' مرة متتالية'
        WHERE id = ?`,
      [result.status || null, next, next, webhook.id],
    );
  } else {
    db.run(
      `UPDATE webhooks SET last_delivery_at = datetime('now'), last_status = ?, failure_streak = ?
        WHERE id = ?`,
      [result.status || null, next, webhook.id],
    );
  }
}

/** يحاول تسليم الحمولة مرة واحدة. */
async function attemptDelivery(webhook, event, body, attempt) {
  const timestamp = Math.floor(Date.now() / 1000);
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Madad-Portal-Webhook/1',
        'X-Madad-Event': event,
        'X-Madad-Delivery': crypto.randomUUID(),
        'X-Madad-Timestamp': String(timestamp),
        'X-Madad-Signature': `sha256=${sign(webhook.secret, timestamp, body)}`,
        'X-Madad-Attempt': String(attempt),
      },
      body,
      signal: controller.signal,
      redirect: 'error',
    });

    return {
      ok: response.ok,
      status: response.status,
      duration: Date.now() - started,
      error: response.ok ? null : `استجابة غير ناجحة: ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      duration: Date.now() - started,
      error: error.name === 'AbortError' ? 'انتهت مهلة الاتصال' : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** يسلّم الحمولة مع إعادة المحاولة المتدرّجة. */
async function deliver(webhook, event, body, attempt = 1) {
  const result = await attemptDelivery(webhook, event, body, attempt);
  recordDelivery(webhook, event, body, attempt, result);

  if (result.ok || attempt >= MAX_ATTEMPTS) return result;

  // أخطاء العميل (4xx) لا تُعاد المحاولة فيها — الخطأ في الطلب لا في الشبكة
  if (result.status && result.status >= 400 && result.status < 500 && result.status !== 429) {
    return result;
  }

  await new Promise((resolve) => {
    const timer = setTimeout(() => { timers.delete(timer); resolve(); }, BACKOFF_MS[attempt]);
    timers.add(timer);
  });

  const still = db.get('SELECT is_active FROM webhooks WHERE id = ?', [webhook.id]);
  if (!still || !still.is_active) return result;

  return deliver(webhook, event, body, attempt + 1);
}

/**
 * يبثّ حدثاً إلى كل الاشتراكات المهتمّة به.
 * لا يرمي أخطاء أبداً حتى لا يُفشل العملية الأصلية.
 */
function emit(event, data) {
  if (!EVENT_KEYS.includes(event)) return;

  let subscribers = [];
  try {
    subscribers = db.all('SELECT * FROM webhooks WHERE is_active = 1')
      .filter((webhook) => normalizeEvents(webhook.events).includes(event));
  } catch {
    return; // قاعدة البيانات غير مهيّأة بعد
  }

  if (!subscribers.length) return;

  const body = JSON.stringify({
    event,
    sent_at: new Date().toISOString(),
    company: config.company.nameAr,
    data,
  });

  subscribers.forEach((webhook) => {
    // الإرسال في الخلفية: لا ننتظره ولا نسمح لخطئه بالخروج
    deliver(webhook, event, body).catch(() => {});
  });
}

/** يلغي أي محاولات مؤجّلة (يُستخدم عند إيقاف الخادم في الاختبارات). */
function cancelPending() {
  timers.forEach((timer) => clearTimeout(timer));
  timers.clear();
}

module.exports = {
  EVENTS, EVENT_KEYS, emit, sign, generateSecret, normalizeEvents, validateUrl,
  deliver, cancelPending, MAX_ATTEMPTS, MAX_FAILURE_STREAK,
};
