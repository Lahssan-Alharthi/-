'use strict';

const crypto = require('crypto');

const PREFIX = 'mdd';
const VISIBLE_LENGTH = 14; // الجزء الظاهر للتعريف: mdd_live_xxxxx

/**
 * نطاقات الوصول المتاحة لمفاتيح الربط.
 * المفتاح لا يملك إلا ما يُمنح له صراحةً.
 */
const SCOPES = {
  'employees:read': 'قراءة بيانات الموظفين (بدون الرواتب)',
  'departments:read': 'قراءة الأقسام',
  'attendance:read': 'قراءة سجلات الحضور',
  'attendance:write': 'دفع سجلات الحضور من أجهزة البصمة',
  'leaves:read': 'قراءة طلبات الإجازات',
  'payroll:read': 'قراءة الرواتب والبيانات المالية',
  'fleet:read': 'قراءة بيانات الأسطول',
  'fleet:write': 'تحديث حالة المركبات وعدّاداتها',
  'trips:read': 'قراءة الرحلات',
  'trips:write': 'إنشاء الرحلات وتحديث حالتها',
};

const SCOPE_KEYS = Object.keys(SCOPES);

/**
 * يولّد مفتاحاً جديداً.
 * المفتاح الكامل يُعرض مرة واحدة فقط ولا يُخزَّن، ويُحفظ منه تلبيدة SHA-256.
 * المفاتيح عالية العشوائية (256 بت) فلا حاجة لدالة تلبيد بطيئة.
 */
function generateKey(environment) {
  const env = environment === 'test' ? 'test' : 'live';
  const secret = crypto.randomBytes(32).toString('base64url');
  const key = `${PREFIX}_${env}_${secret}`;

  return {
    key,
    prefix: key.slice(0, VISIBLE_LENGTH),
    hash: hashKey(key),
  };
}

function hashKey(key) {
  return crypto.createHash('sha256').update(String(key)).digest('hex');
}

/** مقارنة ثابتة الزمن بين تلبيدتين. */
function hashesMatch(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** يستخرج المفتاح من ترويسة Authorization أو X-API-Key. */
function extractKey(req) {
  const header = req.get('authorization');
  if (header && /^bearer /i.test(header)) return header.slice(7).trim();

  const direct = req.get('x-api-key');
  return direct ? direct.trim() : null;
}

/** ينقّي قائمة النطاقات ويحذف غير المعروف منها. */
function normalizeScopes(input) {
  const list = Array.isArray(input)
    ? input
    : String(input || '').split(',');

  return [...new Set(
    list.map((scope) => String(scope).trim()).filter((scope) => SCOPE_KEYS.includes(scope)),
  )];
}

module.exports = {
  SCOPES, SCOPE_KEYS, generateKey, hashKey, hashesMatch, extractKey, normalizeScopes,
};
