'use strict';

const config = require('../config');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** صيغ الجنسية السعودية المقبولة في حقل الجنسية. */
const SAUDI_ALIASES = new Set([
  'سعودي', 'سعودية', 'السعودية', 'سعودي/ة', 'سعوديه',
  'المملكة العربية السعودية', 'saudi', 'saudi arabia', 'saudi arabian', 'ksa', 'sa',
]);

/** يزيل التشكيل والمسافات الزائدة ويوحّد الألف والتاء المربوطة. */
function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[ً-ْ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/\s+/g, ' ');
}

/** هل الموظف سعودي الجنسية؟ */
function isSaudi(nationality) {
  return SAUDI_ALIASES.has(normalize(nationality));
}

/** هل الجنسية مسجّلة أصلاً؟ يُستخدم للتنبيه على الملفات الناقصة. */
function hasNationality(nationality) {
  return normalize(nationality).length > 0;
}

/**
 * يحسب اشتراك التأمينات الاجتماعية لموظف واحد.
 *
 * الوعاء = الراتب الأساسي + بدل السكن، بحدّ أقصى شهري قابل للضبط.
 * يعيد حصة الموظف (تُخصم من الراتب) وحصة صاحب العمل (تكلفة على الشركة).
 */
function computeGosi(employee) {
  const settings = config.payroll.gosi;
  const saudi = isSaudi(employee.nationality);
  const rates = saudi ? settings.saudi : settings.nonSaudi;

  const rawWage = (Number(employee.basic_salary) || 0) + (Number(employee.housing_allowance) || 0);
  const cap = Number(settings.maxContributoryWage) || 0;
  const base = cap > 0 ? Math.min(rawWage, cap) : rawWage;

  const total = round2(base * rates.totalRate);
  const employeeShare = round2(base * rates.employeeRate);

  return {
    category: saudi ? 'saudi' : 'non_saudi',
    category_label: saudi ? 'سعودي' : 'غير سعودي',
    nationality_missing: !hasNationality(employee.nationality),
    contributory_wage: round2(base),
    capped: cap > 0 && rawWage > cap,
    total_rate: rates.totalRate,
    employee_rate: rates.employeeRate,
    employer_rate: round2(rates.totalRate - rates.employeeRate),
    total_amount: total,
    employee_amount: employeeShare,
    employer_amount: round2(total - employeeShare),
  };
}

module.exports = { isSaudi, hasNationality, computeGosi, SAUDI_ALIASES };
