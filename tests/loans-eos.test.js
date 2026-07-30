'use strict';

/**
 * اختبارات السلف بالأقساط ومخالصة نهاية الخدمة.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'madad-loans-'));
process.env.DB_FILE = path.join(workDir, 'loans.db');
process.env.UPLOADS_DIR = path.join(workDir, 'uploads');
process.env.JWT_SECRET = 'test-secret-loans';
process.env.NODE_ENV = 'test';

const db = require('../server/db');
const app = require('../server/index');
const config = require('../server/config');
const loans = require('../server/utils/loans');
const { computeEndOfService, serviceYears, entitlementFactor } = require('../server/utils/eos');
const { hashPassword } = require('../server/utils/password');

let server;
let baseUrl;
const PASSWORD = 'Test@1234';
const ids = {};

async function login(email) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  assert.strictEqual(response.status, 200, `فشل الدخول: ${email}`);
  return response.headers.getSetCookie()[0].split(';')[0];
}

function call(method, urlPath, cookie, body) {
  return fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
}

test.before(async () => {
  db.migrate();
  db.run("INSERT INTO departments (code, name_ar) VALUES ('OPS', 'العمليات')");
  db.run(`INSERT INTO leave_types (code, name_ar, max_days, paid, deducts_balance, requires_attachment)
          VALUES ('ANNUAL', 'إجازة سنوية', 30, 1, 1, 0)`);

  const insert = (no, name, email, role, extra) => {
    const fields = {
      employee_no: no, full_name_ar: name, email, role,
      password_hash: hashPassword(PASSWORD), status: 'active',
      basic_salary: 9000, housing_allowance: 2250, transport_allowance: 900,
      nationality: 'سعودي', hire_date: '2018-03-01', annual_leave_balance: 30, ...(extra || {}),
    };
    const cols = Object.keys(fields);
    const info = db.run(
      `INSERT INTO employees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
      cols.map((c) => fields[c]),
    );
    return Number(info.lastInsertRowid);
  };

  ids.admin = insert('9001', 'مدير النظام', 'admin@test.sa', 'admin');
  ids.hr = insert('9002', 'موارد بشرية', 'hr@test.sa', 'hr');
  ids.finance = insert('9003', 'مالية', 'fin@test.sa', 'finance');
  ids.employee = insert('9004', 'موظف السلفة', 'emp@test.sa', 'employee');
  ids.other = insert('9005', 'موظف آخر', 'other@test.sa', 'employee');
  ids.newHire = insert('9006', 'موظف جديد', 'new@test.sa', 'employee', { hire_date: '2025-06-01' });
  ids.cancelTarget = insert('9007', 'موظف الإلغاء', 'cancel@test.sa', 'employee');
  ids.flexible = insert('9008', 'موظف المرونة', 'flex@test.sa', 'employee');
  ids.rounding = insert('9009', 'موظف التقريب', 'round@test.sa', 'employee');
  ids.reschedule = insert('9010', 'موظف الجدولة', 'resched@test.sa', 'employee');

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  if (server) server.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

// ------------------------------------------------------- السلف بالأقساط

test('السلفة تُقسّم على أقساط شهرية بدل خصمها كاملة', async () => {
  const cookie = await login('fin@test.sa');
  const created = await call('POST', '/api/loans', cookie, {
    employee_id: ids.employee, amount: 6000, installments: 6,
    start_year: 2030, start_month: 1,
  });

  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.body.data.amount, 6000);
  assert.strictEqual(created.body.data.installments, 6);
  assert.strictEqual(created.body.data.monthly_amount, 1000);
  assert.strictEqual(created.body.data.remaining_amount, 6000);

  ids.loan = created.body.data.id;
});

test('قسط الشهر لا يُستحق قبل شهر بداية السلفة', () => {
  assert.strictEqual(loans.installmentDue(ids.employee, 2029, 12).total, 0);
  assert.strictEqual(loans.installmentDue(ids.employee, 2030, 1).total, 1000);
});

test('مسيّر الرواتب يخصم القسط لا السلفة كاملة', async () => {
  const cookie = await login('fin@test.sa');
  const run = await call('POST', '/api/payroll/runs', cookie, { year: 2030, month: 1 });
  assert.strictEqual(run.status, 201);

  const details = await call('GET', `/api/payroll/runs/${run.body.data.id}`, cookie);
  const slip = details.body.data.payslips.find((s) => s.employee_id === ids.employee);

  assert.strictEqual(slip.loan_deduction, 1000, 'يُخصم القسط فقط');
  assert.notStrictEqual(slip.loan_deduction, 6000, 'لا تُخصم السلفة كاملة');

  // القسط لا يُسجَّل مدفوعاً قبل اعتماد المسيّر
  assert.strictEqual(loans.paidAmount(ids.loan), 0);

  await call('POST', `/api/payroll/runs/${run.body.data.id}/approve`, cookie, {});
  assert.strictEqual(loans.paidAmount(ids.loan), 1000, 'يُسجَّل القسط بعد الاعتماد');

  const loan = db.get('SELECT * FROM loans WHERE id = ?', [ids.loan]);
  assert.strictEqual(loans.remainingAmount(loan), 5000);
});

test('حذف مسيّر مسودة لا يؤثّر على رصيد السلفة', async () => {
  const cookie = await login('fin@test.sa');
  const run = await call('POST', '/api/payroll/runs', cookie, { year: 2030, month: 2 });
  assert.strictEqual(run.status, 201);

  const paidBefore = loans.paidAmount(ids.loan);
  const removed = await call('DELETE', `/api/payroll/runs/${run.body.data.id}`, cookie);
  assert.strictEqual(removed.status, 200);

  assert.strictEqual(loans.paidAmount(ids.loan), paidBefore, 'الرصيد لا يتأثّر بمسيّر محذوف');
});

test('السلفة تُنتهي تلقائياً بعد سداد كل الأقساط', async () => {
  const cookie = await login('fin@test.sa');

  // خمسة أشهر متتالية لإكمال الأقساط الستة
  for (let month = 2; month <= 6; month += 1) {
    // eslint-disable-next-line no-await-in-loop
    const run = await call('POST', '/api/payroll/runs', cookie, { year: 2030, month });
    assert.strictEqual(run.status, 201, `فشل توليد مسيّر الشهر ${month}`);
    // eslint-disable-next-line no-await-in-loop
    await call('POST', `/api/payroll/runs/${run.body.data.id}/approve`, cookie, {});
  }

  const loan = db.get('SELECT * FROM loans WHERE id = ?', [ids.loan]);
  assert.strictEqual(loans.paidAmount(ids.loan), 6000);
  assert.strictEqual(loans.remainingAmount(loan), 0);
  assert.strictEqual(loan.status, 'settled', 'تُعلَّم السلفة مسدّدة');

  // لا خصم بعد السداد
  const run = await call('POST', '/api/payroll/runs', cookie, { year: 2030, month: 7 });
  const details = await call('GET', `/api/payroll/runs/${run.body.data.id}`, cookie);
  const slip = details.body.data.payslips.find((s) => s.employee_id === ids.employee);
  assert.strictEqual(slip.loan_deduction, 0);
});

test('القسط لا يتجاوز الرصيد المتبقّي في آخر دفعة', async () => {
  const cookie = await login('fin@test.sa');
  const created = await call('POST', '/api/loans', cookie, {
    employee_id: ids.other, amount: 2500, installments: 3, start_year: 2031, start_month: 1,
  });
  const loanId = created.body.data.id;
  // 2500 / 3 = 833.33 لكل قسط، والمجموع 2499.99 فالقسط الأخير يُعدّل
  assert.strictEqual(created.body.data.monthly_amount, 833.33);

  for (let month = 1; month <= 3; month += 1) {
    // eslint-disable-next-line no-await-in-loop
    const run = await call('POST', '/api/payroll/runs', cookie, { year: 2031, month });
    // eslint-disable-next-line no-await-in-loop
    await call('POST', `/api/payroll/runs/${run.body.data.id}/approve`, cookie, {});
  }

  const paid = loans.paidAmount(loanId);
  assert.ok(paid <= 2500, `المسدّد ${paid} لا يجوز أن يتجاوز مبلغ السلفة`);
});

test('اعتماد طلب سلفة يُنشئ جدول أقساط', async () => {
  const employeeCookie = await login('emp@test.sa');
  const request = await call('POST', '/api/requests', employeeCookie, {
    type: 'سلفة', subject: 'سلفة بأقساط', amount: 4800,
  });
  assert.strictEqual(request.status, 201);

  const financeCookie = await login('fin@test.sa');
  const decision = await call('POST', `/api/requests/${request.body.data.id}/decision`,
    financeCookie, { decision: 'approved', installments: 4, start_year: 2032, start_month: 1 });

  assert.strictEqual(decision.status, 200);
  assert.ok(decision.body.loan, 'يجب إنشاء سلفة عند اعتماد الطلب');
  assert.strictEqual(decision.body.loan.installments, 4);
  assert.strictEqual(decision.body.loan.monthly_amount, 1200);
  assert.match(decision.body.message, /قسط/);
});

test('عدد الأقساط محدود بالحد الأقصى المسموح', async () => {
  const cookie = await login('fin@test.sa');
  const tooMany = await call('POST', '/api/loans', cookie, {
    employee_id: ids.other, amount: 1000, installments: config.payroll.maxLoanInstallments + 1,
  });
  assert.strictEqual(tooMany.status, 400);

  const zero = await call('POST', '/api/loans', cookie, {
    employee_id: ids.other, amount: 1000, installments: 0,
  });
  // صفر يُعامل كقسط واحد
  assert.strictEqual(zero.status, 201);
  assert.strictEqual(zero.body.data.installments, 1);
});

test('الموظف يرى سلفه فقط ولا ينشئ سلفة', async () => {
  const cookie = await login('emp@test.sa');
  const list = await call('GET', '/api/loans', cookie);
  assert.strictEqual(list.status, 200);
  assert.ok(list.body.data.every((l) => l.employee_id === ids.employee));

  const create = await call('POST', '/api/loans', cookie, { employee_id: ids.employee, amount: 5000 });
  assert.strictEqual(create.status, 403);
});

test('إلغاء السلفة يوقف الخصم ولا يخصم المتبقّي', async () => {
  const cookie = await login('fin@test.sa');
  // موظف مستقل حتى لا تتداخل سلف الاختبارات الأخرى
  const created = await call('POST', '/api/loans', cookie, {
    employee_id: ids.cancelTarget, amount: 3000, installments: 3, start_year: 2033, start_month: 1,
  });
  const loanId = created.body.data.id;

  assert.strictEqual(loans.installmentDue(ids.cancelTarget, 2033, 1).total, 1000);

  const cancelled = await call('POST', `/api/loans/${loanId}/cancel`, cookie, { reason: 'تسوية نقدية' });
  assert.strictEqual(cancelled.status, 200);
  assert.match(cancelled.body.message, /3000/);

  assert.strictEqual(loans.installmentDue(ids.cancelTarget, 2033, 1).total, 0,
    'السلفة الملغاة لا تُخصم');
});

test('صاحب الصلاحية يحدّد مبلغ القسط فيُشتقّ عدد الأقساط', async () => {
  const cookie = await login('fin@test.sa');
  const byAmount = await call('POST', '/api/loans', cookie, {
    employee_id: ids.flexible, amount: 3000, monthly_amount: 750,
    start_year: 2035, start_month: 1,
  });

  assert.strictEqual(byAmount.status, 201);
  assert.strictEqual(byAmount.body.data.monthly_amount, 750);
  assert.strictEqual(byAmount.body.data.installments, 4, '3000 ÷ 750 = 4 أقساط');
});

test('اشتقاق الجدول من المبلغ أو من العدد يعطي النتيجة نفسها', () => {
  const byCount = loans.resolveSchedule(3000, { installments: 6 });
  const byAmount = loans.resolveSchedule(3000, { monthlyAmount: 500 });
  assert.deepStrictEqual(byCount, byAmount);

  // مبلغ لا يقسم المجموع بالتساوي يرفع عدد الأقساط لتغطية الباقي
  const uneven = loans.resolveSchedule(1000, { monthlyAmount: 300 });
  assert.strictEqual(uneven.installments, 4, '300×3=900 فيلزم قسط رابع للباقي');

  assert.ok(loans.resolveSchedule(1000, { monthlyAmount: 0 }).error);
  assert.ok(loans.resolveSchedule(1000, { monthlyAmount: 5000 }).error);
});

test('مبلغ القسط الذي يحدّده صاحب الصلاحية يُحفظ كما هو', async () => {
  const cookie = await login('fin@test.sa');
  // 4000 بقسط 1300: ثلاثة أقساط كاملة والرابع 100 — لا يُعاد اشتقاق القسط من العدد
  const created = await call('POST', '/api/loans', cookie, {
    employee_id: ids.flexible, amount: 4000, monthly_amount: 1300,
    start_year: 2038, start_month: 1,
  });

  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.body.data.monthly_amount, 1300,
    'يجب حفظ مبلغ القسط المحدّد لا 4000÷4');
  assert.strictEqual(created.body.data.installments, 4);

  const loanId = created.body.data.id;
  const amounts = [];
  for (let month = 1; month <= 4; month += 1) {
    // eslint-disable-next-line no-await-in-loop
    const run = await call('POST', '/api/payroll/runs', cookie, { year: 2038, month });
    // eslint-disable-next-line no-await-in-loop
    await call('POST', `/api/payroll/runs/${run.body.data.id}/approve`, cookie, {});
    amounts.push(db.get(
      'SELECT amount FROM loan_payments WHERE loan_id = ? AND year = 2038 AND month = ?',
      [loanId, month],
    ).amount);
  }

  assert.deepStrictEqual(amounts, [1300, 1300, 1300, 100], 'الأقساط كما حدّدها صاحب الصلاحية');
  assert.strictEqual(loans.paidAmount(loanId), 4000);
});

test('مبلغ قسط غير صالح مرفوض من المسار', async () => {
  const cookie = await login('fin@test.sa');
  const tooBig = await call('POST', '/api/loans', cookie, {
    employee_id: ids.flexible, amount: 1000, monthly_amount: 5000,
  });
  assert.strictEqual(tooBig.status, 400);
  assert.match(tooBig.body.error, /يتجاوز مبلغ السلفة/);
});

test('القسط الأخير يستوعب كسر التقريب فتُقفل السلفة بالمبلغ كاملاً', async () => {
  const cookie = await login('fin@test.sa');
  // 2500 على 3 أقساط: 833.33 + 833.33 + 833.34 = 2500 بالضبط
  const created = await call('POST', '/api/loans', cookie, {
    employee_id: ids.rounding, amount: 2500, installments: 3,
    start_year: 2036, start_month: 1,
  });
  const loanId = created.body.data.id;
  assert.strictEqual(created.body.data.monthly_amount, 833.33);

  const amounts = [];
  for (let month = 1; month <= 3; month += 1) {
    // eslint-disable-next-line no-await-in-loop
    const run = await call('POST', '/api/payroll/runs', cookie, { year: 2036, month });
    // eslint-disable-next-line no-await-in-loop
    await call('POST', `/api/payroll/runs/${run.body.data.id}/approve`, cookie, {});
    amounts.push(db.get(
      'SELECT amount FROM loan_payments WHERE loan_id = ? AND year = 2036 AND month = ?',
      [loanId, month],
    ).amount);
  }

  assert.deepStrictEqual(amounts, [833.33, 833.33, 833.34], 'القسط الأخير يعوّض الكسر');
  assert.strictEqual(loans.paidAmount(loanId), 2500);
  assert.strictEqual(db.get('SELECT status FROM loans WHERE id = ?', [loanId]).status, 'settled');

  // ولا يُخصم قسط رابع بقيمة قروش
  const extra = await call('POST', '/api/payroll/runs', cookie, { year: 2036, month: 4 });
  const details = await call('GET', `/api/payroll/runs/${extra.body.data.id}`, cookie);
  const slip = details.body.data.payslips.find((s) => s.employee_id === ids.rounding);
  assert.strictEqual(slip.loan_deduction, 0, 'لا قسط إضافي بعد السداد الكامل');
});

test('إعادة جدولة المتبقّي بمبلغ قسط جديد', async () => {
  const cookie = await login('fin@test.sa');
  const created = await call('POST', '/api/loans', cookie, {
    employee_id: ids.reschedule, amount: 6000, installments: 6,
    start_year: 2037, start_month: 1,
  });
  const loanId = created.body.data.id;

  const run = await call('POST', '/api/payroll/runs', cookie, { year: 2037, month: 1 });
  await call('POST', `/api/payroll/runs/${run.body.data.id}/approve`, cookie, {});
  assert.strictEqual(loans.paidAmount(loanId), 1000);

  // تخفيف العبء: 500 شهرياً على المتبقّي 5000
  const rescheduled = await call('PUT', `/api/loans/${loanId}`, cookie, { monthly_amount: 500 });
  assert.strictEqual(rescheduled.status, 200);
  assert.strictEqual(rescheduled.body.data.monthly_amount, 500);
  assert.strictEqual(rescheduled.body.data.installments, 11, 'قسط مسدّد + 10 أقساط جديدة');

  assert.strictEqual(loans.installmentDue(ids.reschedule, 2037, 2).total, 500);
});

// -------------------------------------------------- مخالصة نهاية الخدمة

test('حساب مدة الخدمة ونسبة الاستحقاق', () => {
  assert.strictEqual(Math.round(serviceYears('2020-01-01', '2025-01-01') * 100) / 100, 5.0);
  assert.strictEqual(serviceYears('2025-01-01', '2020-01-01'), 0, 'تاريخ عكسي يعطي صفراً');
  assert.strictEqual(serviceYears(null, '2025-01-01'), 0);

  // إنهاء من صاحب العمل: كامل المكافأة دائماً
  assert.strictEqual(entitlementFactor('termination', 1), 1);
  assert.strictEqual(entitlementFactor('contract_end', 20), 1);

  // الاستقالة: متدرّجة
  assert.strictEqual(entitlementFactor('resignation', 1.5), 0);
  assert.strictEqual(entitlementFactor('resignation', 3), 1 / 3);
  assert.strictEqual(entitlementFactor('resignation', 7), 2 / 3);
  assert.strictEqual(entitlementFactor('resignation', 12), 1);
});

test('مكافأة نهاية الخدمة: نصف أجر للسنوات الخمس الأولى وأجر كامل بعدها', () => {
  const employee = {
    basic_salary: 10000, housing_allowance: 0, transport_allowance: 0, other_allowance: 0,
    hire_date: '2020-01-01',
  };

  // خمس سنوات بالضبط ⇽ 5 × نصف شهر = 2.5 شهر = 25000
  const fiveYears = computeEndOfService(employee, {
    lastWorkingDay: '2024-12-31', reason: 'termination',
  });
  assert.ok(Math.abs(fiveYears.gratuity_amount - 25000) < 60,
    `متوقّع نحو 25000 وورد ${fiveYears.gratuity_amount}`);

  // عشر سنوات ⇽ 2.5 + 5 = 7.5 شهر = 75000
  const tenYears = computeEndOfService(employee, {
    lastWorkingDay: '2029-12-31', reason: 'termination',
  });
  assert.ok(Math.abs(tenYears.gratuity_amount - 75000) < 120,
    `متوقّع نحو 75000 وورد ${tenYears.gratuity_amount}`);
});

test('الاستقالة قبل سنتين لا تستحق مكافأة', () => {
  const result = computeEndOfService(
    { basic_salary: 8000, hire_date: '2025-06-01' },
    { lastWorkingDay: '2026-07-30', reason: 'resignation' },
  );
  assert.strictEqual(result.gratuity_amount, 0);
  assert.strictEqual(result.eligible, false);
  assert.match(result.note, /سنتين/);
});

test('المخالصة تحسم السلف القائمة وتضيف بدل الإجازات', () => {
  const result = computeEndOfService(
    { basic_salary: 9000, housing_allowance: 2250, transport_allowance: 900, hire_date: '2018-03-01' },
    {
      lastWorkingDay: '2026-07-30', reason: 'termination',
      unusedLeaveDays: 12, outstandingLoans: 3000, otherDues: 500, otherDeductions: 200,
    },
  );

  assert.strictEqual(result.monthly_wage, 12150);
  assert.strictEqual(result.unused_leave_amount, 4860); // 12 × (12150/30)
  assert.strictEqual(result.total_deductions, 3200);
  assert.strictEqual(result.net_amount,
    Math.round((result.total_dues - result.total_deductions) * 100) / 100);
});

test('دورة المخالصة: تقدير ثم مسودة ثم اعتماد ينهي الخدمة ويسوّي السلف', async () => {
  const financeCookie = await login('fin@test.sa');

  // سلفة قائمة على الموظف الجديد
  await call('POST', '/api/loans', financeCookie, {
    employee_id: ids.newHire, amount: 2000, installments: 4, start_year: 2040, start_month: 1,
  });

  const hrCookie = await login('hr@test.sa');
  const estimate = await call('GET',
    `/api/end-of-service/estimate/${ids.newHire}?last_working_day=2026-12-31&reason=termination`,
    hrCookie);

  assert.strictEqual(estimate.status, 200);
  assert.strictEqual(estimate.body.data.outstanding_loans, 2000, 'يُحتسب رصيد السلفة تلقائياً');
  assert.ok(estimate.body.data.gratuity_amount > 0);

  const created = await call('POST', '/api/end-of-service', hrCookie, {
    employee_id: ids.newHire, last_working_day: '2026-12-31', reason: 'termination',
  });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.body.data.status, 'draft');

  // لا يمكن إنشاء مخالصة ثانية قبل صرف الأولى
  const duplicate = await call('POST', '/api/end-of-service', hrCookie, {
    employee_id: ids.newHire, last_working_day: '2026-12-31', reason: 'termination',
  });
  assert.strictEqual(duplicate.status, 409);

  // الموظف لا يرى المسودة
  const employeeCookie = await login('new@test.sa');
  const hidden = await call('GET', `/api/end-of-service/${created.body.data.id}`, employeeCookie);
  assert.strictEqual(hidden.status, 404);

  const approved = await call('POST', `/api/end-of-service/${created.body.data.id}/approve`,
    financeCookie, {});
  assert.strictEqual(approved.status, 200);

  assert.strictEqual(db.get('SELECT status FROM employees WHERE id = ?', [ids.newHire]).status,
    'terminated', 'تُنهى خدمة الموظف عند اعتماد المخالصة');

  const loan = db.get("SELECT status FROM loans WHERE employee_id = ?", [ids.newHire]);
  assert.strictEqual(loan.status, 'settled', 'تُسوّى السلف القائمة ضمن المخالصة');

  // لا يمكن اعتمادها مرتين
  const again = await call('POST', `/api/end-of-service/${created.body.data.id}/approve`,
    financeCookie, {});
  assert.strictEqual(again.status, 409);

  const paid = await call('POST', `/api/end-of-service/${created.body.data.id}/pay`, financeCookie, {});
  assert.strictEqual(paid.status, 200);
});

test('بدل الإجازات يُحتسب بالتناسب مع مدة العمل في السنة', async () => {
  const cookie = await login('hr@test.sa');

  // موظف عُيّن في 2039-04-01 وآخر يوم عمل 2039-12-31 ⇽ نحو 9 أشهر
  db.run("UPDATE employees SET hire_date = '2039-04-01' WHERE id = ?", [ids.other]);
  const partial = await call('GET',
    `/api/end-of-service/estimate/${ids.other}?last_working_day=2039-12-31&reason=termination`,
    cookie);

  const days = partial.body.data.unused_leave_days;
  assert.ok(days > 20 && days < 24,
    `من عمل تسعة أشهر يستحق نحو 22.5 يوم لا 30، وورد ${days}`);

  // ومن عمل السنة كاملة يستحق الرصيد كاملاً
  db.run("UPDATE employees SET hire_date = '2030-01-01' WHERE id = ?", [ids.other]);
  const full = await call('GET',
    `/api/end-of-service/estimate/${ids.other}?last_working_day=2039-12-31&reason=termination`,
    cookie);
  assert.strictEqual(full.body.data.unused_leave_days, 30);

  db.run("UPDATE employees SET hire_date = '2018-03-01' WHERE id = ?", [ids.other]);
});

test('يوم عمل أخير قبل تاريخ التعيين مرفوض', async () => {
  const cookie = await login('hr@test.sa');
  const result = await call('POST', '/api/end-of-service', cookie, {
    employee_id: ids.employee, last_working_day: '2010-01-01', reason: 'termination',
  });
  assert.strictEqual(result.status, 400);
  assert.match(result.body.error, /التعيين/);
});

test('الموظف لا يُنشئ مخالصة ولا يرى قائمة المخالصات', async () => {
  const cookie = await login('emp@test.sa');
  assert.strictEqual((await call('GET', '/api/end-of-service', cookie)).status, 403);
  assert.strictEqual((await call('POST', '/api/end-of-service', cookie, {
    employee_id: ids.employee, last_working_day: '2026-12-31',
  })).status, 403);
});
