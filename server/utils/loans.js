'use strict';

/**
 * السلف المعتمدة وأقساطها.
 *
 * السلفة تُخصم على أقساط شهرية لا مرة واحدة. قسط الشهر يُحسب من الجدول
 * ولا يُسجَّل كمدفوع إلا عند اعتماد مسيّر الرواتب، فلا يتأثّر الرصيد
 * بمسيّر مسودة أو محذوف.
 */

const db = require('../db');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** يحوّل السنة والشهر إلى رقم قابل للمقارنة. */
const monthIndex = (year, month) => Number(year) * 12 + Number(month);

/** المبلغ المسدّد فعلياً من سلفة. */
function paidAmount(loanId) {
  return round2(db.get(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM loan_payments WHERE loan_id = ?',
    [loanId],
  ).total);
}

/** الرصيد المتبقّي من سلفة. */
function remainingAmount(loan) {
  return round2(loan.amount - paidAmount(loan.id));
}

/** إجمالي أرصدة السلف القائمة لموظف. */
function outstandingForEmployee(employeeId) {
  const loans = db.all(
    "SELECT * FROM loans WHERE employee_id = ? AND status = 'active'",
    [employeeId],
  );
  return round2(loans.reduce((sum, loan) => sum + remainingAmount(loan), 0));
}

/**
 * قسط الشهر المستحقّ على موظف.
 * يتجاوز الأشهر المسدّدة مسبقاً، ولا يتجاوز الرصيد المتبقّي.
 */
function installmentDue(employeeId, year, month) {
  const loans = db.all(
    "SELECT * FROM loans WHERE employee_id = ? AND status = 'active' ORDER BY id",
    [employeeId],
  );

  const target = monthIndex(year, month);
  let total = 0;
  const breakdown = [];

  loans.forEach((loan) => {
    // القسط لا يُستحق قبل شهر بداية السلفة
    if (monthIndex(loan.start_year, loan.start_month) > target) return;

    // شهر سُدّد سابقاً لا يُخصم مرتين
    const already = db.get(
      'SELECT id FROM loan_payments WHERE loan_id = ? AND year = ? AND month = ?',
      [loan.id, year, month],
    );
    if (already) return;

    const remaining = remainingAmount(loan);
    if (remaining <= 0) return;

    // القسط الأخير يستوعب كسر التقريب حتى يُسدَّد المبلغ كاملاً
    // بعدد الأقساط المحدّد بلا قسط إضافي بقيمة قروش
    const paidCount = db.get(
      'SELECT COUNT(*) AS n FROM loan_payments WHERE loan_id = ?', [loan.id],
    ).n;
    const isLast = paidCount + 1 >= loan.installments;

    const amount = isLast ? remaining : round2(Math.min(loan.monthly_amount, remaining));
    if (amount <= 0) return;

    total += amount;
    breakdown.push({
      loan_id: loan.id, amount, remaining_before: remaining, is_last: isLast,
    });
  });

  return { total: round2(total), breakdown };
}

/**
 * يسجّل أقساط الشهر كمدفوعة بعد اعتماد المسيّر، ويُنهي السلف المسدّدة.
 * يُنفَّذ داخل معاملة المسيّر.
 */
function recordPayments(employeeId, year, month, runId) {
  const due = installmentDue(employeeId, year, month);

  due.breakdown.forEach((item) => {
    db.run(
      `INSERT INTO loan_payments (loan_id, run_id, year, month, amount) VALUES (?,?,?,?,?)
       ON CONFLICT(loan_id, year, month) DO NOTHING`,
      [item.loan_id, runId, year, month, item.amount],
    );

    const loan = db.get('SELECT * FROM loans WHERE id = ?', [item.loan_id]);
    if (loan && remainingAmount(loan) <= 0.009) {
      db.run("UPDATE loans SET status = 'settled', settled_at = datetime('now') WHERE id = ?",
        [loan.id]);
    }
  });

  return due.total;
}

/**
 * يستنبط جدول التقسيط بمرونة: صاحب الصلاحية يحدّد إمّا عدد الأقساط
 * وإمّا مبلغ القسط الشهري، ويُشتقّ الآخر منه.
 */
function resolveSchedule(amount, { installments, monthlyAmount }) {
  const total = round2(amount);

  // مبلغ القسط له الأولوية إن حُدّد، فهو الأصرح لصاحب الصلاحية
  if (monthlyAmount !== undefined && monthlyAmount !== null && monthlyAmount !== '') {
    const monthly = round2(monthlyAmount);
    if (monthly <= 0) return { error: 'مبلغ القسط يجب أن يكون أكبر من صفر' };
    if (monthly > total) return { error: 'مبلغ القسط لا يمكن أن يتجاوز مبلغ السلفة' };
    return { installments: Math.ceil(round2(total / monthly) - 0.0001), monthly };
  }

  const count = Math.max(1, Math.floor(Number(installments) || 1));
  return { installments: count, monthly: round2(total / count) };
}

/** ينشئ سلفة بأقساط شهرية. */
function createLoan({
  employeeId, requestId, amount, installments, monthlyAmount,
  startYear, startMonth, approvedBy, notes,
}) {
  const total = round2(amount);
  const schedule = resolveSchedule(total, { installments, monthlyAmount });
  if (schedule.error) throw new Error(schedule.error);

  const count = schedule.installments;
  const monthly = schedule.monthly;

  const now = new Date();
  const year = Number(startYear) || now.getFullYear();
  const month = Number(startMonth) || now.getMonth() + 1;

  const info = db.run(
    `INSERT INTO loans (employee_id, request_id, amount, installments, monthly_amount,
            start_year, start_month, approved_by, notes)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [employeeId, requestId || null, total, count, monthly, year, month, approvedBy || null, notes || null],
  );

  return Number(info.lastInsertRowid);
}

/** بيانات سلفة معروضة مع رصيدها. */
function present(loan) {
  const paid = paidAmount(loan.id);
  return {
    ...loan,
    paid_amount: paid,
    remaining_amount: round2(loan.amount - paid),
    paid_installments: db.get(
      'SELECT COUNT(*) AS n FROM loan_payments WHERE loan_id = ?', [loan.id],
    ).n,
  };
}

module.exports = {
  paidAmount, remainingAmount, outstandingForEmployee, installmentDue,
  recordPayments, createLoan, resolveSchedule, present,
};
