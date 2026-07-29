'use strict';

const crypto = require('crypto');

const KEY_LEN = 64;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** يولّد بصمة كلمة المرور بصيغة: scrypt$salt$hash */
function hashPassword(plainText) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(plainText), salt, KEY_LEN, SCRYPT_OPTS);
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

/** يتحقّق من كلمة المرور مقابل البصمة المخزّنة (مقارنة ثابتة الزمن). */
function verifyPassword(plainText, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;

  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(String(plainText), salt, expected.length, SCRYPT_OPTS);
  return crypto.timingSafeEqual(expected, actual);
}

/** كلمة مرور مؤقتة تُسلّم للموظف الجديد. */
function generateTempPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i += 1) {
    out += alphabet[crypto.randomInt(alphabet.length)];
  }
  return out;
}

/** فحص متانة كلمة المرور. يعيد رسالة خطأ أو null. */
function checkStrength(password) {
  const value = String(password || '');
  if (value.length < 8) return 'كلمة المرور يجب ألا تقل عن 8 أحرف';
  if (!/[A-Za-z؀-ۿ]/.test(value)) return 'كلمة المرور يجب أن تحتوي على حرف واحد على الأقل';
  if (!/[0-9]/.test(value)) return 'كلمة المرور يجب أن تحتوي على رقم واحد على الأقل';
  return null;
}

module.exports = { hashPassword, verifyPassword, generateTempPassword, checkStrength };
