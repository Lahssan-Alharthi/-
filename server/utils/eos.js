'use strict';

/**
 * حساب مستحقات نهاية الخدمة.
 *
 * القاعدة المطبّقة (نظام العمل السعودي، المادتان 84 و 85):
 *   - نصف أجر شهر لكل سنة من السنوات الخمس الأولى
 *   - أجر شهر كامل لكل سنة بعد الخمس الأولى
 *   - وتُحسب مدة الكسور من السنة بنسبتها
 *
 * وفي حالة الاستقالة يُستحق:
 *   - أقل من سنتين: لا شيء
 *   - من سنتين إلى أقل من خمس: الثلث
 *   - من خمس إلى أقل من عشر: الثلثان
 *   - عشر سنوات أو أكثر: كامل المكافأة
 *
 * ⚠️ القيم والنِسب قابلة للضبط من config.payroll.endOfService، ويجب مراجعتها
 *    مع المختص القانوني قبل الاعتماد عليها في مخالصة فعلية.
 */

const config = require('../config');
const dates = require('./dates');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const REASONS = {
  termination: 'إنهاء من صاحب العمل',
  contract_end: 'انتهاء مدة العقد',
  retirement: 'التقاعد',
  resignation: 'استقالة',
};

/** يحوّل مدة الخدمة بين تاريخين إلى سنوات عشرية. */
function serviceYears(hireDate, lastWorkingDay) {
  if (!dates.isValidDate(hireDate) || !dates.isValidDate(lastWorkingDay)) return 0;

  const start = Date.parse(`${hireDate}T00:00:00Z`);
  const end = Date.parse(`${lastWorkingDay}T00:00:00Z`);
  if (end <= start) return 0;

  // يوم واحد إضافي لأن يوم العمل الأخير محسوب من الخدمة
  const days = (end - start) / dates.DAY_MS + 1;
  return days / 365.25;
}

/** نسبة الاستحقاق حسب سبب انتهاء العلاقة ومدة الخدمة. */
function entitlementFactor(reason, years) {
  const settings = config.payroll.endOfService;

  if (reason !== 'resignation') return 1;

  const tiers = settings.resignationTiers;
  const match = tiers.find((tier) => years >= tier.minYears
    && (tier.maxYears === null || years < tier.maxYears));

  return match ? match.factor : 0;
}

/**
 * يحسب مكافأة نهاية الخدمة ومكوّنات المخالصة.
 *
 * options: { lastWorkingDay, reason, unusedLeaveDays, otherDues,
 *            outstandingLoans, otherDeductions }
 */
function computeEndOfService(employee, options) {
  const settings = config.payroll.endOfService;
  const opts = options || {};

  const lastWorkingDay = opts.lastWorkingDay || dates.today();
  const reason = REASONS[opts.reason] ? opts.reason : 'termination';

  // الأجر المعتمد في الحساب: الأساسي مع البدلات الثابتة حسب الإعداد
  const basic = Number(employee.basic_salary) || 0;
  const allowances = settings.includeAllowances
    ? (Number(employee.housing_allowance) || 0)
      + (Number(employee.transport_allowance) || 0)
      + (Number(employee.other_allowance) || 0)
    : 0;
  const monthlyWage = round2(basic + allowances);

  const years = serviceYears(employee.hire_date, lastWorkingDay);
  const firstTierYears = settings.firstTierYears;

  // نصف أجر لكل سنة في الشريحة الأولى، وأجر كامل لما بعدها
  const earlyYears = Math.min(years, firstTierYears);
  const laterYears = Math.max(0, years - firstTierYears);
  const grossGratuity = (earlyYears * monthlyWage * settings.firstTierMonths)
    + (laterYears * monthlyWage * settings.laterTierMonths);

  const factor = entitlementFactor(reason, years);
  const gratuity = round2(grossGratuity * factor);

  // بدل رصيد الإجازات غير المستنفدة، على أساس أجر اليوم
  const unusedLeaveDays = Math.max(0, Number(opts.unusedLeaveDays) || 0);
  const dailyWage = monthlyWage / 30;
  const unusedLeaveAmount = round2(unusedLeaveDays * dailyWage);

  const otherDues = round2(opts.otherDues);
  const outstandingLoans = round2(opts.outstandingLoans);
  const otherDeductions = round2(opts.otherDeductions);

  const totalDues = round2(gratuity + unusedLeaveAmount + otherDues);
  const totalDeductions = round2(outstandingLoans + otherDeductions);

  return {
    last_working_day: lastWorkingDay,
    reason,
    reason_label: REASONS[reason],
    service_years: Math.round(years * 100) / 100,
    service_breakdown: {
      years: Math.floor(years),
      months: Math.floor((years - Math.floor(years)) * 12),
    },
    monthly_wage: monthlyWage,
    includes_allowances: settings.includeAllowances,
    gratuity_before_factor: round2(grossGratuity),
    gratuity_factor: factor,
    gratuity_amount: gratuity,
    unused_leave_days: unusedLeaveDays,
    unused_leave_amount: unusedLeaveAmount,
    other_dues: otherDues,
    outstanding_loans: outstandingLoans,
    other_deductions: otherDeductions,
    total_dues: totalDues,
    total_deductions: totalDeductions,
    net_amount: round2(totalDues - totalDeductions),
    eligible: factor > 0,
    note: factor === 0
      ? 'لا تُستحق مكافأة نهاية خدمة: استقالة قبل إتمام سنتين من الخدمة'
      : null,
  };
}

module.exports = { REASONS, serviceYears, entitlementFactor, computeEndOfService };
