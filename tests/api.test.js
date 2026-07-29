'use strict';

/**
 * اختبارات تكامل لواجهة البوابة.
 * تعمل على قاعدة بيانات مؤقتة مستقلة عن بيانات التشغيل.
 * التشغيل: npm test
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'madad-test-'));
process.env.DB_FILE = path.join(workDir, 'test.db');
process.env.UPLOADS_DIR = path.join(workDir, 'uploads');
process.env.JWT_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';

const db = require('../server/db');
const app = require('../server/index');
const { hashPassword } = require('../server/utils/password');
const dates = require('../server/utils/dates');

let server;
let baseUrl;

const PASSWORD = 'Test@1234';

/** عميل HTTP بسيط يحتفظ بكوكي الجلسة. */
function client() {
  let cookie = '';
  return {
    async request(method, path, body, raw) {
      const headers = { cookie };
      let payload;

      if (body instanceof URLSearchParams || raw) {
        payload = body;
      } else if (body !== undefined) {
        headers['content-type'] = 'application/json';
        payload = JSON.stringify(body);
      }

      const response = await fetch(`${baseUrl}${path}`, { method, headers, body: payload });
      const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
      setCookie.forEach((entry) => { cookie = entry.split(';')[0]; });

      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* ليس JSON */ }
      return { status: response.status, body: json, text };
    },
    cookieHeader() { return cookie; },
    get(path) { return this.request('GET', path); },
    post(path, body) { return this.request('POST', path, body); },
    put(path, body) { return this.request('PUT', path, body); },
    del(path) { return this.request('DELETE', path); },
  };
}

/** ينشئ موظفاً مباشرة في قاعدة البيانات. */
function makeEmployee(no, name, email, role, extra) {
  const fields = {
    employee_no: no,
    full_name_ar: name,
    email,
    role,
    password_hash: hashPassword(PASSWORD),
    status: 'active',
    basic_salary: 10000,
    housing_allowance: 2500,
    transport_allowance: 1000,
    annual_leave_balance: 30,
    hire_date: '2024-01-01',
    ...(extra || {}),
  };

  const keys = Object.keys(fields);
  const info = db.run(
    `INSERT INTO employees (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
    keys.map((k) => fields[k]),
  );
  return Number(info.lastInsertRowid);
}

const ids = {};

test.before(async () => {
  db.migrate();

  db.run("INSERT INTO departments (code, name_ar) VALUES ('OPS', 'العمليات')");
  const deptId = db.get("SELECT id FROM departments WHERE code = 'OPS'").id;

  db.run(
    `INSERT INTO leave_types (code, name_ar, max_days, paid, deducts_balance, requires_attachment)
     VALUES ('ANNUAL', 'إجازة سنوية', 30, 1, 1, 0), ('SICK', 'إجازة مرضية', 30, 1, 0, 1)`,
  );

  ids.admin = makeEmployee('9001', 'مدير النظام', 'admin@test.sa', 'admin');
  ids.hr = makeEmployee('9002', 'مسؤول الموارد', 'hr@test.sa', 'hr');
  ids.finance = makeEmployee('9003', 'المدير المالي', 'fin@test.sa', 'finance');
  ids.ops = makeEmployee('9004', 'مدير العمليات', 'ops@test.sa', 'operations');
  ids.manager = makeEmployee('9005', 'مدير مباشر', 'mgr@test.sa', 'manager', { department_id: deptId });
  ids.employee = makeEmployee('9006', 'موظف تجريبي', 'emp@test.sa', 'employee',
    { department_id: deptId, manager_id: ids.manager });
  ids.lowBalance = makeEmployee('9007', 'موظف برصيد منخفض', 'lowbalance@test.sa', 'employee',
    { department_id: deptId, manager_id: ids.manager, annual_leave_balance: 3 });

  ids.annualType = db.get("SELECT id FROM leave_types WHERE code = 'ANNUAL'").id;

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(() => {
  if (server) server.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

async function login(email) {
  const c = client();
  const result = await c.post('/auth/login', { email, password: PASSWORD });
  assert.strictEqual(result.status, 200, `فشل تسجيل الدخول لـ ${email}: ${result.text}`);
  return c;
}

// ---------------------------------------------------------------- المصادقة

test('تسجيل الدخول يرفض كلمة المرور الخاطئة', async () => {
  const c = client();
  const result = await c.post('/auth/login', { email: 'emp@test.sa', password: 'wrong' });
  assert.strictEqual(result.status, 401);
});

test('تسجيل الدخول الناجح يعيد بيانات المستخدم', async () => {
  const c = await login('emp@test.sa');
  const me = await c.get('/auth/me');
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.body.user.email, 'emp@test.sa');
  assert.strictEqual(me.body.user.role, 'employee');
});

test('الوصول بدون جلسة مرفوض', async () => {
  const c = client();
  const result = await c.get('/employees');
  assert.strictEqual(result.status, 401);
});

// ------------------------------------------------------------ الصلاحيات

test('الموظف العادي لا يستطيع عرض قائمة الموظفين', async () => {
  const c = await login('emp@test.sa');
  const result = await c.get('/employees');
  assert.strictEqual(result.status, 403);
});

test('الموارد البشرية تستطيع عرض قائمة الموظفين', async () => {
  const c = await login('hr@test.sa');
  const result = await c.get('/employees');
  assert.strictEqual(result.status, 200);
  assert.ok(result.body.data.length >= 6);
});

test('الرواتب مخفية عن الأدوار غير المخوّلة', async () => {
  const opsClient = await login('ops@test.sa');
  const opsList = await opsClient.get('/employees');
  assert.strictEqual(opsList.status, 200);
  assert.strictEqual(opsList.body.data[0].basic_salary, undefined);

  const finClient = await login('fin@test.sa');
  const finList = await finClient.get('/employees');
  assert.ok(finList.body.data[0].basic_salary !== undefined);
});

test('الموظف لا يستطيع الاطلاع على ملف زميله', async () => {
  const c = await login('emp@test.sa');
  const result = await c.get(`/employees/${ids.manager}`);
  assert.strictEqual(result.status, 403);
});

test('الموظف لا يستطيع ترقية دوره بنفسه', async () => {
  const c = await login('emp@test.sa');
  const result = await c.put(`/employees/${ids.employee}`, { role: 'admin' });

  // الحقل غير مسموح به للموظف، فيُتجاهل ويُرفض الطلب لخلوّه من حقول صالحة
  assert.ok(result.status >= 400 && result.status < 500, `متوقع رفض الطلب، ورد ${result.status}`);
  assert.strictEqual(db.get('SELECT role FROM employees WHERE id = ?', [ids.employee]).role, 'employee');
});

test('الموظف يستطيع تحديث بياناته الشخصية فقط', async () => {
  const c = await login('emp@test.sa');
  const result = await c.put(`/employees/${ids.employee}`, { phone: '0501112233', basic_salary: 99999 });
  assert.strictEqual(result.status, 200);

  const row = db.get('SELECT phone, basic_salary FROM employees WHERE id = ?', [ids.employee]);
  assert.strictEqual(row.phone, '0501112233');
  assert.strictEqual(row.basic_salary, 10000, 'يجب تجاهل تعديل الراتب من الموظف');
});

// -------------------------------------------------------------- الحضور

test('دورة الحضور والانصراف تعمل ولا تسمح بالتكرار', async () => {
  const c = await login('emp@test.sa');

  const checkIn = await c.post('/attendance/check-in');
  assert.strictEqual(checkIn.status, 200);

  const duplicate = await c.post('/attendance/check-in');
  assert.strictEqual(duplicate.status, 409);

  const checkOut = await c.post('/attendance/check-out');
  assert.strictEqual(checkOut.status, 200);
  assert.ok(checkOut.body.data.check_out);

  const duplicateOut = await c.post('/attendance/check-out');
  assert.strictEqual(duplicateOut.status, 409);
});

test('الموظف يرى سجل حضوره فقط', async () => {
  const c = await login('emp@test.sa');
  const result = await c.get('/attendance');
  assert.strictEqual(result.status, 200);
  assert.ok(result.body.data.every((r) => r.employee_id === ids.employee));
});

// ------------------------------------------------------------- الإجازات

test('طلب إجازة يتجاوز الحد الأقصى للنوع يُرفض', async () => {
  const c = await login('emp@test.sa');
  const start = dates.addDays(dates.today(), 200);
  const result = await c.post('/leaves', {
    leave_type_id: ids.annualType,
    start_date: start,
    end_date: dates.addDays(start, 60),
    reason: 'إجازة طويلة',
  });
  assert.strictEqual(result.status, 400);
  assert.match(result.body.error, /الحد الأقصى/);
});

test('طلب إجازة يتجاوز الرصيد المتاح يُرفض', async () => {
  const c = await login('lowbalance@test.sa');
  const start = dates.addDays(dates.today(), 30);
  const result = await c.post('/leaves', {
    leave_type_id: ids.annualType,
    start_date: start,
    end_date: dates.addDays(start, 9), // 10 أيام مقابل رصيد 3
  });
  assert.strictEqual(result.status, 400);
  assert.match(result.body.error, /الرصيد/);
});

test('دورة طلب إجازة: تقديم ثم اعتماد من المدير المباشر', async () => {
  const employeeClient = await login('emp@test.sa');
  const start = dates.addDays(dates.today(), 10);
  const end = dates.addDays(dates.today(), 14);

  const created = await employeeClient.post('/leaves', {
    leave_type_id: ids.annualType,
    start_date: start,
    end_date: end,
    reason: 'سفر عائلي',
  });
  assert.strictEqual(created.status, 201);
  assert.strictEqual(created.body.data.status, 'pending');
  assert.strictEqual(created.body.data.days, 5);

  const leaveId = created.body.data.id;

  // التداخل مرفوض
  const overlap = await employeeClient.post('/leaves', {
    leave_type_id: ids.annualType,
    start_date: dates.addDays(dates.today(), 12),
    end_date: dates.addDays(dates.today(), 16),
  });
  assert.strictEqual(overlap.status, 409);

  // الموظف لا يعتمد طلبه
  const selfApprove = await employeeClient.post(`/leaves/${leaveId}/decision`, { decision: 'approved' });
  assert.strictEqual(selfApprove.status, 403);

  const managerClient = await login('mgr@test.sa');
  const approved = await managerClient.post(`/leaves/${leaveId}/decision`, { decision: 'approved' });
  assert.strictEqual(approved.status, 200);
  assert.strictEqual(approved.body.data.status, 'approved');

  // لا يمكن البتّ مرتين
  const again = await managerClient.post(`/leaves/${leaveId}/decision`, { decision: 'rejected' });
  assert.strictEqual(again.status, 409);

  // أيام الإجازة تظهر في سجل الحضور
  const marked = db.get(
    "SELECT COUNT(*) AS n FROM attendance WHERE employee_id = ? AND status = 'leave' AND date BETWEEN ? AND ?",
    [ids.employee, start, end],
  ).n;
  assert.ok(marked > 0, 'يجب تعليم أيام الإجازة في سجل الحضور');

  // الرصيد يتناقص
  const balance = await employeeClient.get('/leaves/balance');
  assert.strictEqual(balance.body.data.used, 5);
  assert.strictEqual(balance.body.data.remaining, 25);

  // إشعار وصل للموظف
  const notifications = await employeeClient.get('/notifications');
  assert.ok(notifications.body.data.some((n) => n.title.includes('اعتماد')));
});

test('مدير آخر لا يعتمد إجازة موظف ليس في فريقه', async () => {
  const hrClient = await login('hr@test.sa');
  const start = dates.addDays(dates.today(), 40);
  const created = await hrClient.post('/leaves', {
    employee_id: ids.hr,
    leave_type_id: ids.annualType,
    start_date: start,
    end_date: dates.addDays(start, 2),
  });
  assert.strictEqual(created.status, 201);

  const managerClient = await login('mgr@test.sa');
  const decision = await managerClient.post(`/leaves/${created.body.data.id}/decision`, { decision: 'approved' });
  assert.strictEqual(decision.status, 403);
});

// -------------------------------------------------------------- الرواتب

test('توليد مسيّر رواتب واعتماده يجعله مرئياً للموظف', async () => {
  const employeeClient = await login('emp@test.sa');

  const beforeApproval = await employeeClient.get('/payroll/my-payslips');
  assert.strictEqual(beforeApproval.body.data.length, 0);

  const financeClient = await login('fin@test.sa');
  const now = new Date();
  const run = await financeClient.post('/payroll/runs', {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  });
  assert.strictEqual(run.status, 201);

  const runId = run.body.data.id;

  // لا يمكن التوليد مرتين لنفس الشهر
  const duplicate = await financeClient.post('/payroll/runs', {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  });
  assert.strictEqual(duplicate.status, 409);

  const details = await financeClient.get(`/payroll/runs/${runId}`);
  assert.ok(details.body.data.payslips.length >= 6);

  const slip = details.body.data.payslips.find((p) => p.employee_id === ids.employee);
  // 10000 أساسي + 2500 سكن + 1000 نقل = 13500 قبل الإضافي
  assert.ok(slip.gross_amount >= 13500);
  // التأمينات 9.75% من (الأساسي + السكن) = 1218.75
  assert.strictEqual(slip.gosi_deduction, 1218.75);
  assert.ok(slip.net_amount < slip.gross_amount);

  // قبل الاعتماد لا يظهر للموظف
  const stillHidden = await employeeClient.get('/payroll/my-payslips');
  assert.strictEqual(stillHidden.body.data.length, 0);

  const approve = await financeClient.post(`/payroll/runs/${runId}/approve`);
  assert.strictEqual(approve.status, 200);

  const afterApproval = await employeeClient.get('/payroll/my-payslips');
  assert.strictEqual(afterApproval.body.data.length, 1);

  // لا يمكن حذف مسيّر معتمد
  const remove = await financeClient.del(`/payroll/runs/${runId}`);
  assert.strictEqual(remove.status, 409);
});

test('الموظف لا يستطيع توليد مسيّر رواتب', async () => {
  const c = await login('emp@test.sa');
  const result = await c.post('/payroll/runs', { year: 2030, month: 1 });
  assert.strictEqual(result.status, 403);
});

test('الموظف لا يطّلع على إشعار راتب زميله', async () => {
  const financeClient = await login('fin@test.sa');
  const runs = await financeClient.get('/payroll/runs');
  const details = await financeClient.get(`/payroll/runs/${runs.body.data[0].id}`);
  const other = details.body.data.payslips.find((p) => p.employee_id !== ids.employee);

  const employeeClient = await login('emp@test.sa');
  const result = await employeeClient.get(`/payroll/payslips/${other.id}`);
  assert.strictEqual(result.status, 403);
});

// ------------------------------------------------------ الأسطول والرحلات

test('دورة الرحلة: إنشاء ثم تشغيل ثم إكمال تحدّث حالة المركبة والعداد', async () => {
  const opsClient = await login('ops@test.sa');

  const vehicle = await opsClient.post('/fleet', {
    plate_no: 'أ ب ج 1111', type: 'شاحنة', make_model: 'فولفو', odometer_km: 1000,
  });
  assert.strictEqual(vehicle.status, 201);
  const vehicleId = vehicle.body.data.id;

  const trip = await opsClient.post('/trips', {
    vehicle_id: vehicleId,
    driver_id: ids.employee,
    origin: 'الرياض',
    destination: 'جدة',
    distance_km: 950,
    cargo: 'مواد غذائية',
  });
  assert.strictEqual(trip.status, 201);
  assert.match(trip.body.data.code, /^TRP-\d{4}-\d{4}$/);
  const tripId = trip.body.data.id;

  // السائق يستطيع تحديث حالة رحلته
  const driverClient = await login('emp@test.sa');
  const started = await driverClient.post(`/trips/${tripId}/status`, { status: 'in_progress' });
  assert.strictEqual(started.status, 200);
  assert.strictEqual(db.get('SELECT status FROM vehicles WHERE id = ?', [vehicleId]).status, 'on_trip');

  const completed = await driverClient.post(`/trips/${tripId}/status`, { status: 'completed' });
  assert.strictEqual(completed.status, 200);

  const after = db.get('SELECT status, odometer_km FROM vehicles WHERE id = ?', [vehicleId]);
  assert.strictEqual(after.status, 'available');
  assert.strictEqual(after.odometer_km, 1950, 'يجب إضافة مسافة الرحلة إلى العداد');

  // لا يمكن حذف المركبة أثناء وجود رحلة نشطة
  const secondTrip = await opsClient.post('/trips', {
    vehicle_id: vehicleId, origin: 'جدة', destination: 'مكة المكرمة',
  });
  assert.strictEqual(secondTrip.status, 201);
  const blocked = await opsClient.del(`/fleet/${vehicleId}`);
  assert.strictEqual(blocked.status, 409);
});

test('السائق لا يحدّث حالة رحلة ليست له', async () => {
  const opsClient = await login('ops@test.sa');
  const trip = await opsClient.post('/trips', {
    origin: 'الدمام', destination: 'الجبيل', driver_id: ids.manager,
  });

  const driverClient = await login('emp@test.sa');
  const result = await driverClient.post(`/trips/${trip.body.data.id}/status`, { status: 'completed' });
  assert.strictEqual(result.status, 403);
});

test('السائق يرى رحلاته فقط', async () => {
  const c = await login('emp@test.sa');
  const result = await c.get('/trips');
  assert.strictEqual(result.status, 200);
  assert.ok(result.body.data.every((t) => t.driver_id === ids.employee));
});

// ------------------------------------------------------- طلبات الخدمات

test('دورة طلب خدمة: تقديم ثم اعتماد', async () => {
  const employeeClient = await login('emp@test.sa');
  const created = await employeeClient.post('/requests', {
    type: 'سلفة', subject: 'طلب سلفة', amount: 3000,
  });
  assert.strictEqual(created.status, 201);
  const requestId = created.body.data.id;

  // الموظف لا يبتّ في طلبه
  const selfDecide = await employeeClient.post(`/requests/${requestId}/decision`, { decision: 'approved' });
  assert.strictEqual(selfDecide.status, 403);

  const financeClient = await login('fin@test.sa');
  const decided = await financeClient.post(`/requests/${requestId}/decision`, {
    decision: 'approved', response: 'تمت الموافقة',
  });
  assert.strictEqual(decided.status, 200);
  assert.strictEqual(decided.body.data.status, 'approved');
});

test('طلب سلفة بدون مبلغ يُرفض', async () => {
  const c = await login('emp@test.sa');
  const result = await c.post('/requests', { type: 'سلفة', subject: 'سلفة' });
  assert.strictEqual(result.status, 400);
});

// ------------------------------------------------------------- الأقسام

test('لا يمكن حذف قسم مرتبط بموظفين', async () => {
  const c = await login('hr@test.sa');
  const departments = await c.get('/departments');
  const used = departments.body.data.find((d) => d.employees_count > 0);
  const result = await c.del(`/departments/${used.id}`);
  assert.strictEqual(result.status, 409);
});

// ------------------------------------------------------------ الإعدادات

test('سجل النشاط متاح لمدير النظام فقط', async () => {
  const hrClient = await login('hr@test.sa');
  assert.strictEqual((await hrClient.get('/audit')).status, 403);

  const adminClient = await login('admin@test.sa');
  const result = await adminClient.get('/audit');
  assert.strictEqual(result.status, 200);
  assert.ok(result.body.data.length > 0, 'يجب تسجيل الأحداث في سجل النشاط');
});

test('تعديل الإعدادات مقصور على مدير النظام', async () => {
  const hrClient = await login('hr@test.sa');
  assert.strictEqual((await hrClient.put('/settings', { 'work.start_time': '09:00' })).status, 403);

  const adminClient = await login('admin@test.sa');
  const result = await adminClient.put('/settings', { 'work.start_time': '09:00' });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(db.get("SELECT value FROM settings WHERE key = 'work.start_time'").value, '09:00');
});

// ------------------------------------------------------------- التقارير

test('التقارير تُصدَّر بصيغة CSV مع ترميز عربي صحيح', async () => {
  const c = await login('hr@test.sa');
  const result = await c.get('/reports/attendance?format=csv');
  assert.strictEqual(result.status, 200);
  assert.match(result.text, /الاسم/);

  // فحص البايتات مباشرة: TextDecoder يزيل علامة BOM عند فك الترميز
  const raw = await fetch(`${baseUrl}/reports/attendance?format=csv`, { headers: { cookie: c.cookieHeader() } });
  const bytes = Buffer.from(await raw.arrayBuffer());
  assert.deepStrictEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'يجب أن يبدأ الملف بعلامة BOM');
});

test('إنشاء موظف يعيد كلمة مرور مؤقتة صالحة للدخول', async () => {
  const hrClient = await login('hr@test.sa');
  const created = await hrClient.post('/employees', {
    full_name_ar: 'موظف جديد',
    email: 'new@test.sa',
    job_title: 'منسق',
  });
  assert.strictEqual(created.status, 201);
  assert.ok(created.body.temp_password);

  const newClient = client();
  const loginResult = await newClient.post('/auth/login', {
    email: 'new@test.sa',
    password: created.body.temp_password,
  });
  assert.strictEqual(loginResult.status, 200);
  assert.strictEqual(loginResult.body.user.must_change_password, true);

  // كلمة المرور الضعيفة مرفوضة
  const weak = await newClient.post('/auth/change-password', {
    current_password: created.body.temp_password,
    new_password: 'abc',
  });
  assert.strictEqual(weak.status, 400);

  const changed = await newClient.post('/auth/change-password', {
    current_password: created.body.temp_password,
    new_password: 'Strong@2026',
  });
  assert.strictEqual(changed.status, 200);
});

test('البريد الإلكتروني المكرر مرفوض', async () => {
  const c = await login('hr@test.sa');
  const result = await c.post('/employees', { full_name_ar: 'مكرر', email: 'emp@test.sa' });
  assert.strictEqual(result.status, 409);
});
