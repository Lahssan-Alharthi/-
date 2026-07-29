'use strict';

const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const config = {
  root: ROOT,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  env: process.env.NODE_ENV || 'development',

  dbFile: process.env.DB_FILE || path.join(ROOT, 'data', 'madad.db'),
  uploadsDir: process.env.UPLOADS_DIR || path.join(ROOT, 'data', 'uploads'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 8 * 1024 * 1024),

  jwtSecret: process.env.JWT_SECRET || 'madad-dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  cookieName: 'madad_token',

  company: {
    nameAr: 'شركة مدد للخدمات اللوجستية',
    nameEn: 'Madad Logistics Services Co.',
    shortAr: 'مدد',
  },

  // سياسة الدوام الافتراضية (يمكن تعديلها من الإعدادات)
  work: {
    startTime: '08:00',
    endTime: '17:00',
    graceMinutes: 15,
    workDaysPerMonth: 30,
    weekend: [5, 6], // الجمعة والسبت (0 = الأحد)
  },

  payroll: {
    gosiRate: 0.0975, // حصة الموظف من التأمينات الاجتماعية
    overtimeRatePerHour: 1.5, // من أجر الساعة
  },
};

if (config.env === 'production' && config.jwtSecret === 'madad-dev-secret-change-me') {
  // eslint-disable-next-line no-console
  console.error('[أمان] يجب ضبط المتغير JWT_SECRET قبل التشغيل في بيئة الإنتاج.');
  process.exit(1);
}

module.exports = config;
