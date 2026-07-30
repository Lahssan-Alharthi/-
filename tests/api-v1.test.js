'use strict';

/**
 * اختبارات واجهة الربط (‏/api/v1) ومفاتيح الوصول.
 * التشغيل: npm test
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'madad-v1-'));
process.env.DB_FILE = path.join(workDir, 'v1.db');
process.env.UPLOADS_DIR = path.join(workDir, 'uploads');
process.env.JWT_SECRET = 'test-secret-v1';
process.env.NODE_ENV = 'test';

const db = require('../server/db');
const app = require('../server/index');
const { hashPassword } = require('../server/utils/password');
const { generateKey } = require('../server/utils/apikey');

let server;
let baseUrl;
const PASSWORD = 'Test@1234';
const ids = {};
const keys = {};

/** طلب موثّق بمفتاح ربط. */
async function apiRequest(method, urlPath, key, body) {
  const headers = {};
  if (key) headers.authorization = `Bearer ${key}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`${baseUrl}${urlPath}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ليس JSON */ }
  return { status: response.status, body: json, headers: response.headers };
}

/** ينشئ مفتاحاً مباشرة في قاعدة البيانات بنطاقات محدّدة. */
function makeKey(name, scopes, extra) {
  const generated = generateKey('test');
  db.run(
    `INSERT INTO api_keys (name, environment, key_prefix, key_hash, scopes, rate_limit, expires_at, revoked_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [name, 'test', generated.prefix, generated.hash, scopes.join(','),
      (extra && extra.rateLimit) || 600, (extra && extra.expiresAt) || null,
      (extra && extra.revokedAt) || null],
  );
  return generated.key;
}

test.before(async () => {
  db.migrate();

  db.run("INSERT INTO departments (code, name_ar) VALUES ('OPS', 'العمليات')");
  db.run(`INSERT INTO leave_types (code, name_ar, max_days, paid, deducts_balance, requires_attachment)
          VALUES ('ANNUAL', 'إجازة سنوية', 30, 1, 1, 0)`);

  const insertEmployee = (no, name, email, role, extra) => {
    const fields = {
      employee_no: no,
      full_name_ar: name,
      email,
      role,
      password_hash: hashPassword(PASSWORD),
      status: 'active',
      basic_salary: 8000,
      housing_allowance: 2000,
      nationality: 'سعودي',
      ...(extra || {}),
    };
    const cols = Object.keys(fields);
    const info = db.run(
      `INSERT INTO employees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
      cols.map((c) => fields[c]),
    );
    return Number(info.lastInsertRowid);
  };

  ids.admin = insertEmployee('9001', 'مدير النظام', 'admin@test.sa', 'admin');
  ids.hr = insertEmployee('9002', 'موارد بشرية', 'hr@test.sa', 'hr');
  ids.driver = insertEmployee('9010', 'سائق تجريبي', 'driver@test.sa', 'employee',
    { job_title: 'سائق شاحنة' });

  db.run(
    `INSERT INTO vehicles (plate_no, type, status, odometer_km) VALUES ('أ ب ج 1234', 'شاحنة', 'available', 5000)`,
  );

  keys.readOnly = makeKey('قراءة فقط', ['employees:read', 'departments:read', 'attendance:read', 'trips:read', 'fleet:read']);
  keys.device = makeKey('جهاز البصمة', ['attendance:write']);
  keys.tms = makeKey('نظام النقل', ['trips:read', 'trips:write', 'fleet:read', 'fleet:write']);
  keys.finance = makeKey('نظام المحاسبة', ['employees:read', 'payroll:read']);
  keys.revoked = makeKey('مفتاح ملغى', ['employees:read'], { revokedAt: '2025-01-01 00:00:00' });
  keys.expired = makeKey('مفتاح منتهي', ['employees:read'], { expiresAt: '2025-01-01' });
  keys.limited = makeKey('محدود المعدل', ['departments:read'], { rateLimit: 3 });

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  if (server) server.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

// ------------------------------------------------------------- التوثيق

test('الواجهة ترفض الطلب بلا مفتاح', async () => {
  const result = await apiRequest('GET', '/api/v1/employees');
  assert.strictEqual(result.status, 401);
});

test('الواجهة ترفض المفتاح غير الصحيح', async () => {
  // ترويسات HTTP تقبل ASCII فقط، فيُستخدم مفتاح لاتيني غير مسجّل
  const result = await apiRequest('GET', '/api/v1/employees', 'mdd_live_not-a-real-key-000');
  assert.strictEqual(result.status, 401);

  // ومفتاح بصيغة مختلفة تماماً
  const malformed = await apiRequest('GET', '/api/v1/employees', 'random-token');
  assert.strictEqual(malformed.status, 401);
});

test('الواجهة ترفض المفتاح الملغى والمنتهي', async () => {
  const revoked = await apiRequest('GET', '/api/v1/employees', keys.revoked);
  assert.strictEqual(revoked.status, 401);
  assert.match(revoked.body.error, /إلغاء/);

  const expired = await apiRequest('GET', '/api/v1/employees', keys.expired);
  assert.strictEqual(expired.status, 401);
  assert.match(expired.body.error, /صلاحية/);
});

test('ping يعيد بيانات المفتاح ونطاقاته', async () => {
  const result = await apiRequest('GET', '/api/v1/ping', keys.readOnly);
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.api_version, 'v1');
  assert.ok(result.body.scopes.includes('employees:read'));
});

test('جلسة المستخدم لا تصلح للوصول إلى واجهة الربط', async () => {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test.sa', password: PASSWORD }),
  });
  const cookie = login.headers.getSetCookie()[0].split(';')[0];

  const result = await fetch(`${baseUrl}/api/v1/employees`, { headers: { cookie } });
  assert.strictEqual(result.status, 401, 'واجهة الربط تتطلّب مفتاحاً لا جلسة');
});

// ------------------------------------------------------------- النطاقات

test('المفتاح لا يصل إلى مسار خارج نطاقاته', async () => {
  const result = await apiRequest('GET', '/api/v1/leaves', keys.readOnly);
  assert.strictEqual(result.status, 403);
  assert.match(result.body.error, /نطاق/);
});

test('مفتاح جهاز البصمة لا يقرأ بيانات الموظفين', async () => {
  const result = await apiRequest('GET', '/api/v1/employees', keys.device);
  assert.strictEqual(result.status, 403);
});

test('البيانات المالية محجوبة عن المفتاح بلا نطاق payroll:read', async () => {
  const plain = await apiRequest('GET', '/api/v1/employees', keys.readOnly);
  assert.strictEqual(plain.status, 200);
  assert.strictEqual(plain.body.data[0].basic_salary, undefined);
  assert.strictEqual(plain.body.data[0].iban, undefined);

  const financial = await apiRequest('GET', '/api/v1/employees', keys.finance);
  assert.ok(financial.body.data[0].basic_salary !== undefined);
});

// -------------------------------------------------------- حد المعدّل

test('تجاوز حد الطلبات يعيد 429 مع ترويسات الحد', async () => {
  const first = await apiRequest('GET', '/api/v1/departments', keys.limited);
  assert.strictEqual(first.status, 200);
  assert.strictEqual(first.headers.get('x-ratelimit-limit'), '3');

  await apiRequest('GET', '/api/v1/departments', keys.limited);
  await apiRequest('GET', '/api/v1/departments', keys.limited);

  const blocked = await apiRequest('GET', '/api/v1/departments', keys.limited);
  assert.strictEqual(blocked.status, 429);
  assert.ok(blocked.headers.get('retry-after'));
});

// --------------------------------------------------- دفع سجلات الحضور

test('دفع سجلات الحضور من جهاز خارجي يُنشئ السجلات ويحسب التأخير', async () => {
  const result = await apiRequest('POST', '/api/v1/attendance', keys.device, {
    records: [
      { employee_no: '9010', date: '2026-03-02', check_in: '08:45', check_out: '17:30' },
      { employee_no: '9010', date: '2026-03-03', check_in: '07:55', check_out: '17:05' },
    ],
  });

  assert.strictEqual(result.status, 201);
  assert.strictEqual(result.body.accepted, 2);
  assert.strictEqual(result.body.rejected, 0);

  const late = db.get(
    "SELECT status, late_minutes, work_minutes FROM attendance WHERE date = '2026-03-02'",
  );
  assert.strictEqual(late.status, 'late'); // 08:45 يتجاوز 08:00 + 15 دقيقة سماح
  assert.strictEqual(late.late_minutes, 30);
  assert.strictEqual(late.work_minutes, 525);

  const onTime = db.get("SELECT status, late_minutes FROM attendance WHERE date = '2026-03-03'");
  assert.strictEqual(onTime.status, 'present');
  assert.strictEqual(onTime.late_minutes, 0);
});

test('الدفعة الجزئية تعيد 207 وتفصّل السجلات المرفوضة', async () => {
  const result = await apiRequest('POST', '/api/v1/attendance', keys.device, {
    records: [
      { employee_no: '9010', date: '2026-03-04', check_in: '08:00' },
      { employee_no: '0000', date: '2026-03-04', check_in: '08:00' }, // موظف غير موجود
      { employee_no: '9010', date: 'غير-صحيح' }, // تاريخ غير صالح
    ],
  });

  assert.strictEqual(result.status, 207);
  assert.strictEqual(result.body.accepted, 1);
  assert.strictEqual(result.body.rejected, 2);
  assert.strictEqual(result.body.results[1].ok, false);
  assert.match(result.body.results[1].error, /غير موجود/);
});

test('إعادة الدفع لنفس اليوم تحدّث السجل ولا تكرّره', async () => {
  await apiRequest('POST', '/api/v1/attendance', keys.device, {
    records: [{ employee_no: '9010', date: '2026-03-05', check_in: '08:00' }],
  });
  await apiRequest('POST', '/api/v1/attendance', keys.device, {
    records: [{ employee_no: '9010', date: '2026-03-05', check_in: '08:00', check_out: '18:00' }],
  });

  const rows = db.all("SELECT * FROM attendance WHERE date = '2026-03-05'");
  assert.strictEqual(rows.length, 1, 'يجب تحديث السجل لا إنشاء سجل ثانٍ');
  assert.strictEqual(rows[0].check_out, '18:00');
});

test('رفض الدفعة الفارغة والدفعة الضخمة', async () => {
  const empty = await apiRequest('POST', '/api/v1/attendance', keys.device, { records: [] });
  assert.strictEqual(empty.status, 400);

  const huge = await apiRequest('POST', '/api/v1/attendance', keys.device, {
    records: Array.from({ length: 501 }, () => ({ employee_no: '9010', date: '2026-03-06' })),
  });
  assert.strictEqual(huge.status, 400);
  assert.match(huge.body.error, /500/);
});

// ------------------------------------------------------------- الرحلات

test('نظام النقل ينشئ رحلة ويحدّث حالتها ويؤثّر على المركبة', async () => {
  const created = await apiRequest('POST', '/api/v1/trips', keys.tms, {
    origin: 'الرياض',
    destination: 'الدمام',
    plate_no: 'أ ب ج 1234',
    driver_employee_no: '9010',
    distance_km: 400,
    cargo: 'مواد بناء',
  });

  assert.strictEqual(created.status, 201);
  const code = created.body.data.code;
  assert.match(code, /^TRP-\d{4}-\d{4}$/);

  const started = await apiRequest('PATCH', `/api/v1/trips/${code}/status`, keys.tms, { status: 'in_progress' });
  assert.strictEqual(started.status, 200);
  assert.strictEqual(db.get("SELECT status FROM vehicles WHERE plate_no = 'أ ب ج 1234'").status, 'on_trip');

  const done = await apiRequest('PATCH', `/api/v1/trips/${code}/status`, keys.tms, { status: 'completed' });
  assert.strictEqual(done.status, 200);
  assert.ok(done.body.data.arrive_at, 'يجب تعيين وقت الوصول عند الإكمال');

  const vehicle = db.get("SELECT status, odometer_km FROM vehicles WHERE plate_no = 'أ ب ج 1234'");
  assert.strictEqual(vehicle.status, 'available');
  assert.strictEqual(vehicle.odometer_km, 5400);
});

test('إنشاء رحلة بمركبة غير موجودة يُرفض', async () => {
  const result = await apiRequest('POST', '/api/v1/trips', keys.tms, {
    origin: 'جدة', destination: 'مكة المكرمة', plate_no: 'لا-توجد',
  });
  assert.strictEqual(result.status, 404);
});

test('مفتاح القراءة لا ينشئ رحلة', async () => {
  const result = await apiRequest('POST', '/api/v1/trips', keys.readOnly, {
    origin: 'جدة', destination: 'الطائف',
  });
  assert.strictEqual(result.status, 403);
});

// ------------------------------------------------------------- الأسطول

test('نظام التتبّع يحدّث عدّاد المركبة ويُرفض التراجع بالقراءة', async () => {
  const forward = await apiRequest('PATCH', '/api/v1/fleet/أ ب ج 1234', keys.tms, { odometer_km: 6000 });
  assert.strictEqual(forward.status, 200);
  assert.strictEqual(forward.body.data.odometer_km, 6000);

  const backward = await apiRequest('PATCH', '/api/v1/fleet/أ ب ج 1234', keys.tms, { odometer_km: 100 });
  assert.strictEqual(backward.status, 400);
  assert.match(backward.body.error, /أقل/);
});

// ------------------------------------------------- إدارة المفاتيح

test('إدارة المفاتيح مقصورة على مدير النظام', async () => {
  const loginAs = async (email) => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    return response.headers.getSetCookie()[0].split(';')[0];
  };

  const hrCookie = await loginAs('hr@test.sa');
  const denied = await fetch(`${baseUrl}/api/api-keys`, { headers: { cookie: hrCookie } });
  assert.strictEqual(denied.status, 403);

  const adminCookie = await loginAs('admin@test.sa');
  const allowed = await fetch(`${baseUrl}/api/api-keys`, { headers: { cookie: adminCookie } });
  assert.strictEqual(allowed.status, 200);
});

test('المفتاح المُنشأ يُعاد مرة واحدة ويعمل فوراً، والإلغاء يوقفه', async () => {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test.sa', password: PASSWORD }),
  });
  const cookie = login.headers.getSetCookie()[0].split(';')[0];

  const created = await fetch(`${baseUrl}/api/api-keys`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'مفتاح اختبار الإنشاء', scopes: ['departments:read'] }),
  });
  const payload = await created.json();

  assert.strictEqual(created.status, 201);
  assert.ok(payload.api_key.startsWith('mdd_'));

  // المفتاح الكامل لا يُخزَّن في قاعدة البيانات
  const stored = db.get('SELECT key_hash FROM api_keys WHERE name = ?', ['مفتاح اختبار الإنشاء']);
  assert.notStrictEqual(stored.key_hash, payload.api_key);

  const works = await apiRequest('GET', '/api/v1/departments', payload.api_key);
  assert.strictEqual(works.status, 200);

  // القائمة لا تُعيد المفتاح نفسه أبداً
  const list = await (await fetch(`${baseUrl}/api/api-keys`, { headers: { cookie } })).json();
  const row = list.data.find((k) => k.name === 'مفتاح اختبار الإنشاء');
  assert.strictEqual(row.key_hash, undefined);
  assert.strictEqual(row.status, 'active');

  const revoked = await fetch(`${baseUrl}/api/api-keys/${row.id}/revoke`, {
    method: 'POST', headers: { cookie },
  });
  assert.strictEqual(revoked.status, 200);

  const blocked = await apiRequest('GET', '/api/v1/departments', payload.api_key);
  assert.strictEqual(blocked.status, 401);
});

test('إنشاء مفتاح بلا نطاقات أو بنطاق مجهول يُرفض', async () => {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test.sa', password: PASSWORD }),
  });
  const cookie = login.headers.getSetCookie()[0].split(';')[0];

  const send = (body) => fetch(`${baseUrl}/api/api-keys`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  assert.strictEqual((await send({ name: 'بلا نطاق', scopes: [] })).status, 400);
  assert.strictEqual((await send({ name: 'نطاق مجهول', scopes: ['root:all'] })).status, 400);
  assert.strictEqual((await send({ name: '', scopes: ['departments:read'] })).status, 400);
});

// ------------------------------------------------- ملفات التطبيق الجوال

test('ملفات التثبيت على الجوال متاحة بالصيغة الصحيحة', async () => {
  const manifest = await fetch(`${baseUrl}/manifest.webmanifest`);
  assert.strictEqual(manifest.status, 200);
  const parsed = JSON.parse(await manifest.text());
  assert.strictEqual(parsed.dir, 'rtl');
  assert.strictEqual(parsed.display, 'standalone');
  assert.ok(parsed.icons.some((icon) => icon.sizes === '512x512'));
  assert.ok(parsed.icons.some((icon) => icon.purpose === 'maskable'));

  const sw = await fetch(`${baseUrl}/sw.js`);
  assert.strictEqual(sw.status, 200);

  const icon = await fetch(`${baseUrl}/icons/icon-512.png`);
  assert.strictEqual(icon.status, 200);
  const bytes = Buffer.from(await icon.arrayBuffer());
  assert.deepStrictEqual([...bytes.subarray(1, 4)], [0x50, 0x4e, 0x47], 'يجب أن يكون ملف PNG صالحاً');
});
