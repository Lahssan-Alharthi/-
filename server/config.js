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
    overtimeRatePerHour: 1.5, // من أجر الساعة

    // الحد الأقصى الافتراضي لعدد أقساط السلفة
    maxLoanInstallments: 24,

    /**
     * مكافأة نهاية الخدمة — نظام العمل السعودي (المادتان 84 و 85).
     * ⚠️ راجع النسب مع المختص القانوني قبل الاعتماد في مخالصة فعلية.
     */
    endOfService: {
      includeAllowances: true, // يُحسب الأجر شاملاً البدلات الثابتة
      firstTierYears: 5,       // الشريحة الأولى من الخدمة
      firstTierMonths: 0.5,    // نصف أجر شهر لكل سنة فيها
      laterTierMonths: 1,      // أجر شهر كامل لكل سنة بعدها
      // نسبة الاستحقاق عند الاستقالة حسب مدة الخدمة
      resignationTiers: [
        { minYears: 0, maxYears: 2, factor: 0 },
        { minYears: 2, maxYears: 5, factor: 1 / 3 },
        { minYears: 5, maxYears: 10, factor: 2 / 3 },
        { minYears: 10, maxYears: null, factor: 1 },
      ],
    },

    /**
     * التأمينات الاجتماعية — تُحتسب على (الراتب الأساسي + بدل السكن).
     *
     * السعوديون:  22% إجمالي الاشتراك = 10% حصة الموظف + 12% حصة صاحب العمل
     * غير السعوديين: 2% فرع الأخطار المهنية، يتحمّلها صاحب العمل بالكامل
     *
     * حصة الموظف وحدها هي التي تُخصم من صافي الراتب، أمّا حصة صاحب العمل
     * فتُحتسب ضمن تكلفة الشركة ولا تُخصم من الموظف.
     */
    gosi: {
      saudi: { totalRate: 0.22, employeeRate: 0.10 },
      nonSaudi: { totalRate: 0.02, employeeRate: 0 },
      // الحد الأقصى للأجر الخاضع للاشتراك شهرياً (0 = بلا حد أقصى)
      maxContributoryWage: 45000,

      /**
       * النسب التدريجية للمشتركين الجدد (تعديلات نظام التأمينات 2024).
       *
       * تُطبَّق على السعودي الذي بدأ اشتراكه في التأمينات بتاريخ newSubscriberFrom
       * أو بعده، بنسبة تتدرّج حسب سنة الاستحقاق. ومن اشترك قبل ذلك التاريخ يبقى
       * على النسب الأساسية أعلاه.
       *
       * ⚠️ الأرقام أدناه قابلة للضبط ويجب مطابقتها بالجدول الرسمي الصادر من
       *    المؤسسة العامة للتأمينات الاجتماعية قبل الاعتماد في الصرف الفعلي.
       */
      progressive: {
        enabled: false, // فعّلها بعد مطابقة الجدول الرسمي
        newSubscriberFrom: '2024-07-03',
        // السنة: { إجمالي الاشتراك، حصة الموظف }
        schedule: {
          2025: { totalRate: 0.20, employeeRate: 0.09 },
          2026: { totalRate: 0.21, employeeRate: 0.095 },
          2027: { totalRate: 0.22, employeeRate: 0.10 },
          2028: { totalRate: 0.235, employeeRate: 0.1075 },
          2029: { totalRate: 0.25, employeeRate: 0.115 },
        },
      },
    },
  },
};

if (config.env === 'production' && config.jwtSecret === 'madad-dev-secret-change-me') {
  // eslint-disable-next-line no-console
  console.error('[أمان] يجب ضبط المتغير JWT_SECRET قبل التشغيل في بيئة الإنتاج.');
  process.exit(1);
}

module.exports = config;
