'use strict';

/** خطأ تطبيقي يحمل رمز حالة HTTP ورسالة عربية موجّهة للمستخدم. */
class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (msg, details) => new HttpError(400, msg || 'طلب غير صالح', details);
const unauthorized = (msg) => new HttpError(401, msg || 'يجب تسجيل الدخول أولاً');
const forbidden = (msg) => new HttpError(403, msg || 'لا تملك صلاحية تنفيذ هذا الإجراء');
const notFound = (msg) => new HttpError(404, msg || 'العنصر المطلوب غير موجود');
const conflict = (msg) => new HttpError(409, msg || 'تعارض في البيانات');

/** يغلّف معالجاً غير متزامن ليمرّر الأخطاء إلى معالج الأخطاء المركزي. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict, asyncHandler };
