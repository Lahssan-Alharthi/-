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
 * يحدّد النسب المطبّقة على موظف سعودي، مع مراعاة النسب التدريجية
 * للمشتركين الجدد إن كانت مفعّلة.
 *
 * تاريخ بدء الاشتراك = تاريخ التعيين، ما لم يُسجَّل gosi_join_date صراحةً.
 * سنة الاستحقاق = سنة المسيّر (أو السنة الحالية عند الحساب المباشر).
 */
function saudiRates(employee, year) {
  const settings = config.payroll.gosi;
  const progressive = settings.progressive;

  if (!progressive || !progressive.enabled) return { ...settings.saudi, tier: 'base' };

  const joinDate = employee.gosi_join_date || employee.hire_date;
  if (!joinDate || String(joinDate) < progressive.newSubscriberFrom) {
    return { ...settings.saudi, tier: 'base' };
  }

  const effectiveYear = Number(year) || new Date().getFullYear();
  const years = Object.keys(progressive.schedule).map(Number).sort((a, b) => a - b);
  if (!years.length) return { ...settings.saudi, tier: 'base' };

  // تُستخدم أقرب سنة لا تتجاوز سنة الاستحقاق، وآخر سنة في الجدول لما بعدها
  const match = years.filter((y) => y <= effectiveYear).pop() || years[0];
  return { ...progressive.schedule[match], tier: `progressive:${match}` };
}

/**
 * يحسب اشتراك التأمينات الاجتماعية لموظف واحد.
 *
 * الوعاء = الراتب الأساسي + بدل السكن، بحدّ أقصى شهري قابل للضبط.
 * يعيد حصة الموظف (تُخصم من الراتب) وحصة صاحب العمل (تكلفة على الشركة).
 */
function computeGosi(employee, year) {
  const settings = config.payroll.gosi;
  const saudi = isSaudi(employee.nationality);
  const rates = saudi
    ? saudiRates(employee, year)
    : { ...settings.nonSaudi, tier: 'occupational_hazards' };

  const rawWage = (Number(employee.basic_salary) || 0) + (Number(employee.housing_allowance) || 0);
  const cap = Number(settings.maxContributoryWage) || 0;
  const base = cap > 0 ? Math.min(rawWage, cap) : rawWage;

  const total = round2(base * rates.totalRate);
  const employeeShare = round2(base * rates.employeeRate);

  return {
    category: saudi ? 'saudi' : 'non_saudi',
    category_label: saudi ? 'سعودي' : 'غير سعودي',
    tier: rates.tier,
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

module.exports = { isSaudi, hasNationality, computeGosi, saudiRates, SAUDI_ALIASES };
