'use strict';

/**
 * جولة تجريبية كاملة على البوابة تطبع تقريراً بالنتائج.
 * التشغيل: npm run demo   (بعد npm run seed)
 *
 * تُشغّل خادماً مؤقتاً على منفذ حر، وتمرّ على دورة عمل كل وحدة:
 * الدخول بالأدوار، الحضور، الإجازة واعتمادها، الرواتب، الطلبات، الرحلات،
 * واجهة الربط، ودفع الأحداث إلى نظام خارجي.
 */

const http = require('http');
const crypto = require('crypto');

const app = require('../server/index');
const db = require('../server/db');
const hooks = require('../server/utils/webhooks');

const PASSWORD = process.env.SEED_PASSWORD || 'Madad@2026';

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

let passed = 0;
let failed = 0;
const notes = [];

function section(title) {
  process.stdout.write(`\n${C.bold}${C.cyan}── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}${C.reset}\n`);
}

function ok(label, detail) {
  passed += 1;
  process.stdout.write(`  ${C.green}✓${C.reset} ${label}${detail ? `  ${C.dim}${detail}${C.reset}` : ''}\n`);
}

function fail(label, detail) {
  failed += 1;
  notes.push(`${label}: ${detail}`);
  process.stdout.write(`  ${C.red}✗${C.reset} ${label}${detail ? `  ${C.red}${detail}${C.reset}` : ''}\n`);
}

/** يتحقّق من شرط ويطبع النتيجة. */
function check(label, condition, detail) {
  if (condition) ok(label, detail);
  else fail(label, detail || 'لم يتحقّق الشرط');
  return condition;
}

let baseUrl;

/** عميل يحتفظ بكوكي الجلسة. */
function client() {
  let cookie = '';
  return {
    async call(method, path, body, isForm) {
      const headers = { cookie };
      if (body !== undefined && !isForm) headers['content-type'] = 'application/json';

      const response = await fetch(`${baseUrl}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      });

      const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
      setCookie.forEach((entry) => { cookie = entry.split(';')[0]; });

      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* غير JSON */ }
      return { status: response.status, body: json, text, headers: response.headers };
    },
    get(p) { return this.call('GET', p); },
    post(p, b) { return this.call('POST', p, b === undefined ? {} : b); },
    put(p, b) { return this.call('PUT', p, b); },
    del(p) { return this.call('DELETE', p); },
    cookie() { return cookie; },
  };
}

async function loginAs(email) {
  const c = client();
  const result = await c.post('/api/auth/login', { email, password: PASSWORD });
  if (result.status !== 200) throw new Error(`فشل الدخول بـ ${email}: ${result.text.slice(0, 120)}`);
  return { c, user: result.body.user };
}

function apiCall(method, path, key, body) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null), headers: r.headers }));
}

const money = (n) => `${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`;

async function run() {
  // التأكّد من وجود بيانات
  const count = db.get('SELECT COUNT(*) AS n FROM employees').n;
  if (!count) {
    process.stdout.write(`${C.red}قاعدة البيانات فارغة. شغّل أولاً: npm run seed${C.reset}\n`);
    process.exit(1);
  }

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // خادم استقبال محلي لتجربة دفع الأحداث
  const received = [];
  const receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      received.push({ event: req.headers['x-madad-event'], signature: req.headers['x-madad-signature'], timestamp: req.headers['x-madad-timestamp'], body });
      res.writeHead(200); res.end('ok');
    });
  });
  await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  const receiverUrl = `http://127.0.0.1:${receiver.address().port}/hook`;

  process.stdout.write(`${C.bold}جولة تجريبية على بوابة موظفي شركة مدد للخدمات اللوجستية${C.reset}\n`);
  process.stdout.write(`${C.dim}الخادم: ${baseUrl}${C.reset}\n`);

  // ------------------------------------------------------------ الأدوار
  section('١. الدخول بالأدوار وفرض الصلاحيات');

  const admin = await loginAs('admin@madad.com.sa');
  ok('دخول مدير النظام', admin.user.full_name_ar);

  const hr = await loginAs('hr@madad.com.sa');
  ok('دخول الموارد البشرية', hr.user.full_name_ar);

  const finance = await loginAs('finance@madad.com.sa');
  ok('دخول الشؤون المالية', finance.user.full_name_ar);

  const ops = await loginAs('ops@madad.com.sa');
  ok('دخول إدارة العمليات', ops.user.full_name_ar);

  const driver = await loginAs('m.alanazi@madad.com.sa');
  ok('دخول موظف (سائق)', `${driver.user.full_name_ar} — ${driver.user.job_title}`);

  const wrong = await client().post('/api/auth/login', { email: 'admin@madad.com.sa', password: 'خطأ' });
  check('كلمة المرور الخاطئة مرفوضة', wrong.status === 401, `رمز ${wrong.status}`);

  const forbidden = await driver.c.get('/api/employees');
  check('الموظف لا يرى قائمة الموظفين', forbidden.status === 403, `رمز ${forbidden.status}`);

  const opsEmployees = await ops.c.get('/api/employees?limit=1');
  check('إدارة العمليات ترى الموظفين بلا رواتب',
    opsEmployees.status === 200 && opsEmployees.body.data[0].basic_salary === undefined);

  const escalation = await driver.c.put(`/api/employees/${driver.user.id}`, { role: 'admin' });
  const roleAfter = db.get('SELECT role FROM employees WHERE id = ?', [driver.user.id]).role;
  check('محاولة ترقية الدور من الموظف نفسه تُتجاهل',
    roleAfter === 'employee', `الدور بعد المحاولة: ${roleAfter} (رمز ${escalation.status})`);

  // ---------------------------------------------------------- الحضور
  section('٢. الحضور والانصراف');

  const today = await driver.c.get('/api/attendance/today');
  ok('حالة اليوم', `${today.body.data.date} — الدوام ${today.body.data.policy.startTime}–${today.body.data.policy.endTime}`);

  db.run('DELETE FROM attendance WHERE employee_id = ? AND date = ?',
    [driver.user.id, today.body.data.date]);

  const checkIn = await driver.c.post('/api/attendance/check-in');
  check('تسجيل الحضور', checkIn.status === 200, checkIn.body.message);

  const duplicate = await driver.c.post('/api/attendance/check-in');
  check('منع تكرار تسجيل الحضور', duplicate.status === 409, duplicate.body.error);

  const checkOut = await driver.c.post('/api/attendance/check-out');
  check('تسجيل الانصراف', checkOut.status === 200, checkOut.body.message);

  const summary = await driver.c.get(`/api/attendance/summary/${driver.user.id}`);
  ok('ملخّص الشهر', `حضور ${summary.body.data.present_days} — تأخير ${summary.body.data.late_days} — غياب ${summary.body.data.absent_days}`);

  // --------------------------------------------------------- الإجازات
  section('٣. الإجازات ومسار الاعتماد');

  const types = await driver.c.get('/api/leaves/types');
  const annual = types.body.data.find((t) => t.code === 'ANNUAL');

  const future = new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10);
  const futureEnd = new Date(Date.now() + 203 * 86400000).toISOString().slice(0, 10);

  // تنظيف أثر أي جولة سابقة حتى تكون الجولة قابلة للتكرار
  const previous = db.all(
    "SELECT id, start_date, end_date FROM leaves WHERE employee_id = ? AND reason = 'جولة تجريبية'",
    [driver.user.id],
  );
  previous.forEach((row) => {
    db.run("DELETE FROM attendance WHERE employee_id = ? AND status = 'leave' AND date BETWEEN ? AND ?",
      [driver.user.id, row.start_date, row.end_date]);
    db.run('DELETE FROM leaves WHERE id = ?', [row.id]);
  });
  if (previous.length) ok('تنظيف أثر الجولة السابقة', `${previous.length} طلب إجازة`);

  // الرصيد السنوي مرتبط بسنة الإجازة، فيُفحص رصيد سنة الطلب لا السنة الحالية
  const leaveYear = future.slice(0, 4);
  const balanceBefore = await driver.c.get(`/api/leaves/balance?year=${leaveYear}`);
  ok(`الرصيد قبل الطلب (سنة ${leaveYear})`,
    `${balanceBefore.body.data.remaining} يوم من ${balanceBefore.body.data.entitlement}`);

  const leave = await driver.c.post('/api/leaves', {
    leave_type_id: annual.id, start_date: future, end_date: futureEnd, reason: 'جولة تجريبية',
  });
  if (!check('تقديم طلب إجازة', leave.status === 201,
    leave.status === 201 ? `${leave.body.data.days} أيام — ${leave.body.data.status}`
      : (leave.body && leave.body.error) || `رمز ${leave.status}`)) {
    throw new Error('تعذّر تقديم طلب الإجازة، لا يمكن متابعة بقية دورة الإجازات');
  }

  const overlap = await driver.c.post('/api/leaves', {
    leave_type_id: annual.id, start_date: future, end_date: futureEnd,
  });
  check('منع تداخل الإجازات', overlap.status === 409, overlap.body.error);

  const selfApprove = await driver.c.post(`/api/leaves/${leave.body.data.id}/decision`, { decision: 'approved' });
  check('الموظف لا يعتمد إجازته', selfApprove.status === 403);

  const approve = await hr.c.post(`/api/leaves/${leave.body.data.id}/decision`,
    { decision: 'approved', note: 'موافق' });
  check('اعتماد الموارد البشرية للطلب', approve.status === 200, approve.body.message);

  const marked = db.get(
    "SELECT COUNT(*) AS n FROM attendance WHERE employee_id = ? AND status = 'leave' AND date BETWEEN ? AND ?",
    [driver.user.id, future, futureEnd],
  ).n;
  check('أيام الإجازة عُلّمت في سجل الحضور', marked > 0, `${marked} يوم`);

  const balanceAfter = await driver.c.get(`/api/leaves/balance?year=${leaveYear}`);
  check(`رصيد سنة ${leaveYear} تناقص بعد الاعتماد`,
    balanceAfter.body.data.remaining < balanceBefore.body.data.remaining,
    `${balanceBefore.body.data.remaining} ⇽ ${balanceAfter.body.data.remaining} يوم`);

  const otherYearBalance = await driver.c.get(`/api/leaves/balance?year=${new Date().getFullYear()}`);
  check('رصيد السنة الحالية لم يتأثّر بإجازة سنة أخرى',
    otherYearBalance.body.data.year !== Number(leaveYear)
      ? otherYearBalance.body.data.used !== balanceAfter.body.data.used
      : true,
    `مستهلك ${otherYearBalance.body.data.used} يوم في ${otherYearBalance.body.data.year} مقابل ${balanceAfter.body.data.used} في ${leaveYear}`);

  // ---------------------------------------------------------- الرواتب
  section('٤. الرواتب والتأمينات');

  const year = 2029;
  const month = 6;
  db.run('DELETE FROM payroll_runs WHERE year = ? AND month = ?', [year, month]);

  const notAllowed = await driver.c.post('/api/payroll/runs', { year, month });
  check('الموظف لا يولّد مسيّر رواتب', notAllowed.status === 403);

  const run = await finance.c.post('/api/payroll/runs', { year, month });
  check('توليد مسيّر الرواتب', run.status === 201, run.body.message);

  const details = await finance.c.get(`/api/payroll/runs/${run.body.data.id}`);
  const slips = details.body.data.payslips;
  const saudiSlip = slips.find((s) => s.gosi_category === 'saudi');
  const expatSlip = slips.find((s) => s.gosi_category === 'non_saudi');

  ok('عدد إشعارات الرواتب', `${slips.length} موظف`);

  const saudiRate = (saudiSlip.gosi_total / saudiSlip.gosi_wage) * 100;
  check('التأمينات للسعودي 22% من (الأساسي + السكن)',
    Math.abs(saudiRate - 22) < 0.01,
    `${saudiSlip.employee_name}: وعاء ${money(saudiSlip.gosi_wage)} → ${money(saudiSlip.gosi_total)} (${saudiRate.toFixed(2)}%)`);

  ok('  حصة الموظف / حصة الشركة',
    `${money(saudiSlip.gosi_deduction)} (تُخصم) / ${money(saudiSlip.gosi_employer)} (تكلفة الشركة)`);

  const expatRate = (expatSlip.gosi_total / expatSlip.gosi_wage) * 100;
  check('التأمينات لغير السعودي 2% أخطار مهنية',
    Math.abs(expatRate - 2) < 0.01 && expatSlip.gosi_deduction === 0,
    `${expatSlip.employee_name}: ${money(expatSlip.gosi_total)} كلها على الشركة، خصم الموظف ${money(0)}`);

  const netCheck = Math.abs(saudiSlip.net_amount
    - (saudiSlip.gross_amount - saudiSlip.gosi_deduction - saudiSlip.absence_deduction
      - saudiSlip.loan_deduction - saudiSlip.other_deduction)) < 0.01;
  check('حصة صاحب العمل لا تؤثّر على صافي الراتب', netCheck,
    `الصافي ${money(saudiSlip.net_amount)}`);

  const hidden = await driver.c.get('/api/payroll/my-payslips');
  const hasUnapproved = hidden.body.data.some((s) => s.year === year && s.month === month);
  check('إشعار الراتب لا يظهر للموظف قبل الاعتماد', !hasUnapproved);

  const approveRun = await finance.c.post(`/api/payroll/runs/${run.body.data.id}/approve`);
  check('اعتماد المسيّر', approveRun.status === 200, approveRun.body.message);

  const visible = await driver.c.get('/api/payroll/my-payslips');
  check('ظهور الإشعار للموظف بعد الاعتماد',
    visible.body.data.some((s) => s.year === year && s.month === month));

  ok('تكلفة المسيّر على الشركة',
    `${money(details.body.data.total_gross)} استحقاق + ${money(details.body.data.total_gosi_employer)} تأمينات = ${money(details.body.data.total_gross + details.body.data.total_gosi_employer)}`);

  // ------------------------------------------------- الرحلات والأسطول
  section('٥. الرحلات والأسطول');

  const fleet = await ops.c.get('/api/fleet');
  const vehicle = fleet.body.data.find((v) => v.status === 'available');
  ok('مركبات الأسطول', `${fleet.body.data.length} مركبة، منها ${fleet.body.data.filter((v) => v.status === 'available').length} متاحة`);

  const odometerBefore = vehicle.odometer_km;
  const trip = await ops.c.post('/api/trips', {
    origin: 'الرياض', destination: 'الدمام', vehicle_id: vehicle.id,
    driver_id: driver.user.id, distance_km: 400, cargo: 'مواد بناء', client_name: 'عميل تجريبي',
  });
  check('إنشاء رحلة وإسنادها', trip.status === 201, trip.body.data.code);

  const started = await driver.c.post(`/api/trips/${trip.body.data.id}/status`, { status: 'in_progress' });
  const vehicleOnTrip = db.get('SELECT status FROM vehicles WHERE id = ?', [vehicle.id]).status;
  check('السائق يبدأ الرحلة فتُحجز المركبة',
    started.status === 200 && vehicleOnTrip === 'on_trip', `حالة المركبة: ${vehicleOnTrip}`);

  const completed = await driver.c.post(`/api/trips/${trip.body.data.id}/status`, { status: 'completed' });
  const vehicleAfter = db.get('SELECT status, odometer_km FROM vehicles WHERE id = ?', [vehicle.id]);
  check('إكمال الرحلة يحرّر المركبة ويحدّث العدّاد',
    completed.status === 200 && vehicleAfter.status === 'available'
      && Math.abs(vehicleAfter.odometer_km - (odometerBefore + 400)) < 0.01,
    `العدّاد ${odometerBefore} ⇽ ${vehicleAfter.odometer_km} كم`);

  const myTrips = await driver.c.get('/api/trips');
  check('السائق يرى رحلاته فقط',
    myTrips.body.data.every((t) => t.driver_id === driver.user.id),
    `${myTrips.body.data.length} رحلة`);

  // ------------------------------------------------------- طلبات الخدمات
  section('٦. طلبات الخدمات');

  const serviceRequest = await driver.c.post('/api/requests', {
    type: 'خطاب تعريف', subject: 'خطاب تعريف للبنك', details: 'جولة تجريبية',
  });
  check('تقديم طلب خدمة', serviceRequest.status === 201, serviceRequest.body.message);

  const selfDecide = await driver.c.post(`/api/requests/${serviceRequest.body.data.id}/decision`,
    { decision: 'approved' });
  check('الموظف لا يبتّ في طلبه', selfDecide.status === 403);

  const decided = await hr.c.post(`/api/requests/${serviceRequest.body.data.id}/decision`,
    { decision: 'approved', response: 'الخطاب جاهز للاستلام' });
  check('الموارد البشرية تبتّ في الطلب', decided.status === 200, decided.body.message);

  // ------------------------------------------------------------ التقارير
  section('٧. التقارير');

  for (const [name, path] of [
    ['الحضور الشهري', '/api/reports/attendance'],
    ['الإجازات', '/api/reports/leaves'],
    ['القوى العاملة', '/api/reports/headcount'],
    ['عمليات النقل', '/api/reports/trips'],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const report = await hr.c.get(path);
    check(`تقرير ${name}`, report.status === 200, `${report.body.data.length} سجل`);
  }

  const csv = await hr.c.get('/api/reports/headcount?format=csv');
  check('تصدير CSV بترميز عربي', csv.status === 200 && /القسم/.test(csv.text));

  // -------------------------------------------------------- واجهة الربط
  section('٨. الربط بالأنظمة الخارجية (‏/api/v1)');

  const keyName = `جولة تجريبية ${Date.now()}`;
  const created = await admin.c.post('/api/api-keys', {
    name: keyName,
    scopes: ['employees:read', 'attendance:write', 'attendance:read', 'trips:read'],
  });
  check('إنشاء مفتاح ربط', created.status === 201, `${created.body.api_key.slice(0, 18)}…`);
  const key = created.body.api_key;

  const noKey = await fetch(`${baseUrl}/api/v1/employees`).then((r) => r.status);
  check('الواجهة ترفض الطلب بلا مفتاح', noKey === 401);

  const sessionOnApi = await fetch(`${baseUrl}/api/v1/employees`, {
    headers: { cookie: admin.c.cookie() },
  }).then((r) => r.status);
  check('جلسة المستخدم لا تصلح على واجهة الربط', sessionOnApi === 401);

  const ping = await apiCall('GET', '/api/v1/ping', key);
  ok('اتصال الواجهة', `${ping.body.api_version} — نطاقات: ${ping.body.scopes.length}`);

  const outOfScope = await apiCall('GET', '/api/v1/payroll/runs', key);
  check('نطاق غير ممنوح مرفوض', outOfScope.status === 403, outOfScope.body.error);

  const apiEmployees = await apiCall('GET', '/api/v1/employees?limit=1', key);
  check('الحقول المالية محجوبة بلا نطاق payroll:read',
    apiEmployees.body.data[0].basic_salary === undefined);

  const pushDate = '2026-11-18';
  const push = await apiCall('POST', '/api/v1/attendance', key, {
    records: [
      { employee_no: '1009', date: pushDate, check_in: '08:40', check_out: '17:20' },
      { employee_no: '1010', date: pushDate, check_in: '07:55', check_out: '17:05' },
      { employee_no: '0000', date: pushDate },
    ],
  });
  check('دفع الحضور من جهاز بصمة (دفعة جزئية)',
    push.status === 207 && push.body.accepted === 2 && push.body.rejected === 1,
    `قُبل ${push.body.accepted}، رُفض ${push.body.rejected} — ${push.body.results[2].error}`);

  const lateRecord = db.get(
    'SELECT status, late_minutes FROM attendance WHERE date = ? AND employee_id = (SELECT id FROM employees WHERE employee_no = ?)',
    [pushDate, '1009'],
  );
  check('احتساب التأخير تلقائياً من السجل المدفوع',
    lateRecord.status === 'late' && lateRecord.late_minutes === 25,
    `${lateRecord.late_minutes} دقيقة تأخير`);

  const limitHeader = apiEmployees.headers.get('x-ratelimit-limit');
  ok('ترويسات حد الطلبات', `الحد ${limitHeader} طلب/دقيقة`);

  const keyRow = db.get('SELECT id FROM api_keys WHERE name = ?', [keyName]);
  await admin.c.post(`/api/api-keys/${keyRow.id}/revoke`);
  const afterRevoke = await apiCall('GET', '/api/v1/ping', key);
  check('إلغاء المفتاح يوقفه فوراً', afterRevoke.status === 401, afterRevoke.body.error);

  // --------------------------------------------------------- دفع الأحداث
  section('٩. دفع الأحداث إلى الأنظمة (Webhooks)');

  const hookName = `مستقبِل تجريبي ${Date.now()}`;
  const hook = await admin.c.post('/api/webhooks', {
    name: hookName, url: receiverUrl, events: ['leave.decided', 'trip.created', 'payroll.approved'],
  });
  check('إنشاء اشتراك أحداث', hook.status === 201, `${hook.body.data.events.length} أحداث مشترَك فيها`);
  const secret = hook.body.secret;

  const testDelivery = await admin.c.post(`/api/webhooks/${hook.body.data.id}/test`,
    { event: 'trip.created' });
  check('تسليم حدث تجريبي', testDelivery.body.ok === true, testDelivery.body.message);

  if (received.length) {
    const last = received[received.length - 1];
    const expected = crypto.createHmac('sha256', secret)
      .update(`${last.timestamp}.${last.body}`).digest('hex');
    check('التحقّق من توقيع HMAC-SHA256', last.signature === `sha256=${expected}`,
      `${last.signature.slice(0, 24)}…`);
  }

  // حدث حقيقي: إنشاء رحلة
  const before = received.length;
  await ops.c.post('/api/trips', { origin: 'جدة', destination: 'مكة المكرمة' });
  const deadline = Date.now() + 4000;
  while (received.length <= before && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  check('حدث حقيقي يُدفع عند إنشاء رحلة',
    received.length > before,
    received.length > before ? `الحدث: ${received[received.length - 1].event}` : 'لم يصل');

  const deliveries = await admin.c.get(`/api/webhooks/${hook.body.data.id}/deliveries`);
  ok('سجل التسليم', `${deliveries.body.data.length} محاولة مسجّلة`);

  await admin.c.del(`/api/webhooks/${hook.body.data.id}`);
  ok('حذف الاشتراك التجريبي');

  // ---------------------------------------------------- تطبيق الجوال
  section('١٠. ملفات التطبيق على الجوال');

  const manifest = await fetch(`${baseUrl}/manifest.webmanifest`);
  const parsed = JSON.parse(await manifest.text());
  check('المانيفست متاح وصحيح',
    manifest.status === 200 && parsed.display === 'standalone' && parsed.dir === 'rtl',
    `${parsed.short_name} — ${parsed.icons.length} أيقونات، ${parsed.shortcuts.length} اختصارات`);

  const sw = await fetch(`${baseUrl}/sw.js`);
  check('عامل الخدمة متاح', sw.status === 200);

  const icon = await fetch(`${baseUrl}/icons/icon-512.png`);
  const iconBytes = Buffer.from(await icon.arrayBuffer());
  check('أيقونة التطبيق صالحة',
    icon.status === 200 && iconBytes.subarray(1, 4).toString() === 'PNG',
    `${(iconBytes.length / 1024).toFixed(1)} كيلوبايت`);

  // ---------------------------------------------------- سجل النشاط
  section('١١. سجل النشاط');

  const audit = await admin.c.get('/api/audit?limit=200');
  const actions = [...new Set(audit.body.data.map((a) => a.action))];
  ok('أحداث مسجّلة', `${audit.body.data.length} حدث، ${actions.length} نوع إجراء`);
  check('عمليات الأنظمة الخارجية مسجّلة',
    actions.some((a) => a.startsWith('api:')),
    actions.filter((a) => a.startsWith('api:')).join('، '));

  const hrAudit = await hr.c.get('/api/audit');
  check('سجل النشاط محجوب عن غير مدير النظام', hrAudit.status === 403);

  // ------------------------------------------------------------- الخلاصة
  const total = passed + failed;
  process.stdout.write(`\n${C.bold}${'═'.repeat(62)}${C.reset}\n`);
  if (failed === 0) {
    process.stdout.write(`${C.green}${C.bold}  اكتملت الجولة بنجاح: ${passed}/${total} تحقّق${C.reset}\n`);
  } else {
    process.stdout.write(`${C.red}${C.bold}  نجح ${passed} وفشل ${failed} من ${total}${C.reset}\n`);
    notes.forEach((note) => process.stdout.write(`${C.red}  • ${note}${C.reset}\n`));
  }
  process.stdout.write(`${C.bold}${'═'.repeat(62)}${C.reset}\n\n`);

  hooks.cancelPending();
  server.close();
  receiver.close();
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  process.stdout.write(`\n${C.red}توقّفت الجولة: ${error.message}${C.reset}\n`);
  process.exit(1);
});
