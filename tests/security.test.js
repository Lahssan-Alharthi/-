'use strict';

/**
 * اختبارات أمنية تثبّت الضمانات التي فُحصت يدوياً، فلا تنكسر مستقبلاً:
 * منع تسريب الأسرار، وعزل بيانات الموظفين، وخصائص الجلسة والترويسات،
 * وتصفية الملفات المرفوعة، وحدود المدخلات.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'madad-sec-'));
process.env.DB_FILE = path.join(workDir, 'sec.db');
process.env.UPLOADS_DIR = path.join(workDir, 'uploads');
process.env.JWT_SECRET = 'test-secret-security';
process.env.NODE_ENV = 'test';

const db = require('../server/db');
const app = require('../server/index');
const { hashPassword } = require('../server/utils/password');
const { generateKey } = require('../server/utils/apikey');

let server;
let baseUrl;
const PASSWORD = 'Test@1234';
const ids = {};

/** مفاتيح لا يجوز أن تظهر في أي استجابة. */
const FORBIDDEN_KEYS = ['password_hash', 'key_hash', '"secret"', 'jwtSecret'];

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
  }).then(async (r) => ({ status: r.status, text: await r.text() }));
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
      basic_salary: 9000, housing_allowance: 2250, nationality: 'سعودي',
      hire_date: '2020-01-01', iban: 'SA0380000000608010167519', ...(extra || {}),
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
  ids.employee = insert('9004', 'موظف', 'emp@test.sa', 'employee');
  ids.victim = insert('9005', 'زميل', 'victim@test.sa', 'employee');

  // موارد تخصّ الزميل ليحاول الموظف الوصول إليها
  const key = generateKey('test');
  db.run(
    `INSERT INTO api_keys (name, environment, key_prefix, key_hash, scopes)
     VALUES ('مفتاح', 'test', ?, ?, 'employees:read')`,
    [key.prefix, key.hash],
  );
  db.run(
    `INSERT INTO webhooks (name, url, secret, events)
     VALUES ('اشتراك', 'http://127.0.0.1:9/x', 'whsec_test', 'leave.decided')`,
  );
  db.run(
    `INSERT INTO loans (employee_id, amount, installments, monthly_amount, start_year, start_month)
     VALUES (?, 3000, 3, 1000, 2030, 1)`,
    [ids.victim],
  );
  db.run(
    `INSERT INTO end_of_service (employee_id, last_working_day, reason, monthly_wage, net_amount)
     VALUES (?, '2030-01-01', 'termination', 9000, 50000)`,
    [ids.victim],
  );

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  if (server) server.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

// -------------------------------------------------- تسريب الأسرار

test('لا تُعيد أي استجابة كلمات المرور ولا أسرار المفاتيح', async () => {
  const cookie = await login('admin@test.sa');

  const endpoints = [
    '/api/auth/me', '/api/employees?limit=5', `/api/employees/${ids.employee}`,
    '/api/employees/lookup', '/api/employees/org-chart', '/api/dashboard',
    '/api/loans', '/api/end-of-service', '/api/api-keys', '/api/webhooks',
    '/api/audit?limit=10', '/api/leaves', '/api/requests', '/api/trips',
    '/api/fleet', '/api/documents', '/api/settings', '/api/departments',
    '/api/notifications',
  ];

  for (const endpoint of endpoints) {
    // eslint-disable-next-line no-await-in-loop
    const result = await call('GET', endpoint, cookie);
    assert.strictEqual(result.status, 200, `${endpoint} أعاد ${result.status}`);
    FORBIDDEN_KEYS.forEach((key) => {
      assert.ok(!result.text.includes(key), `تسريب ${key} في ${endpoint}`);
    });
  }
});

test('قائمة مفاتيح الربط لا تكشف المفتاح ولا تلبيدته', async () => {
  const cookie = await login('admin@test.sa');
  const result = await call('GET', '/api/api-keys', cookie);
  const rows = JSON.parse(result.text).data;

  assert.ok(rows.length > 0);
  rows.forEach((row) => {
    assert.strictEqual(row.key_hash, undefined);
    assert.strictEqual(row.api_key, undefined);
    assert.ok(row.key_prefix, 'تُعرض البادئة فقط للتعريف');
  });
});

test('قائمة اشتراكات الأحداث لا تكشف سر التوقيع', async () => {
  const cookie = await login('admin@test.sa');
  const rows = JSON.parse((await call('GET', '/api/webhooks', cookie)).text).data;
  rows.forEach((row) => assert.strictEqual(row.secret, undefined));
});

// ---------------------------------------------- عزل بيانات الموظفين

test('الموظف لا يصل إلى موارد زميله (IDOR)', async () => {
  const cookie = await login('emp@test.sa');

  const loanId = db.get('SELECT id FROM loans WHERE employee_id = ?', [ids.victim]).id;
  const eosId = db.get('SELECT id FROM end_of_service WHERE employee_id = ?', [ids.victim]).id;

  const cases = [
    [`/api/employees/${ids.victim}`, 403],
    [`/api/attendance/summary/${ids.victim}`, 403],
    [`/api/leaves/balance/${ids.victim}`, 403],
    [`/api/loans/${loanId}`, 403],
    [`/api/end-of-service/${eosId}`, 403],
    ['/api/end-of-service', 403],
    ['/api/api-keys', 403],
    ['/api/webhooks', 403],
    ['/api/audit', 403],
    ['/api/employees', 403],
  ];

  for (const [endpoint, expected] of cases) {
    // eslint-disable-next-line no-await-in-loop
    const result = await call('GET', endpoint, cookie);
    assert.strictEqual(result.status, expected, `${endpoint} أعاد ${result.status} بدل ${expected}`);
  }
});

test('الموظف لا يرى الحقول المالية لغيره في أي مسار', async () => {
  const cookie = await login('emp@test.sa');
  const own = await call('GET', `/api/employees/${ids.employee}`, cookie);
  assert.strictEqual(own.status, 200, 'يرى ملفه هو');
  assert.ok(own.text.includes('iban'), 'ويرى بياناته المالية هو');

  const lookup = await call('GET', '/api/employees/lookup', cookie);
  assert.ok(!lookup.text.includes('iban'), 'قائمة الأسماء لا تحمل بيانات بنكية');
  assert.ok(!lookup.text.includes('basic_salary'));
});

test('إدارة العمليات ترى الموظفين بلا رواتب ولا حسابات بنكية', async () => {
  db.run("UPDATE employees SET role = 'operations' WHERE id = ?", [ids.hr]);
  const cookie = await login('hr@test.sa');
  const result = await call('GET', '/api/employees?limit=5', cookie);

  assert.strictEqual(result.status, 200);
  assert.ok(!result.text.includes('basic_salary'));
  assert.ok(!result.text.includes('iban'));

  db.run("UPDATE employees SET role = 'hr' WHERE id = ?", [ids.hr]);
});

// -------------------------------------------------- الجلسة والترويسات

test('كوكي الجلسة HttpOnly ومحدود النطاق', async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@test.sa', password: PASSWORD }),
  });

  const cookie = response.headers.getSetCookie()[0];
  assert.match(cookie, /HttpOnly/i, 'الكوكي غير متاح لجافاسكربت');
  assert.match(cookie, /SameSite=Lax/i, 'يمنع الإرسال في الطلبات عبر المواقع');
  assert.match(cookie, /Max-Age=\d+/, 'للجلسة عمر محدود');
});

test('ترويسات الأمان مضبوطة على كل استجابة', async () => {
  const response = await fetch(`${baseUrl}/`);
  assert.strictEqual(response.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(response.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.strictEqual(response.headers.get('referrer-policy'), 'same-origin');

  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/, 'لا يُسمح بسكربتات خارجية ولا inline');
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), 'لا unsafe-inline في السكربتات');

  assert.strictEqual(response.headers.get('x-powered-by'), null, 'لا يُفصح عن الخادم');
});

// ------------------------------------------------------- المرفقات

async function upload(cookie, filename, contentType, content) {
  const form = new FormData();
  form.append('file', new Blob([content], { type: contentType }), filename);
  form.append('title', 'اختبار');

  const response = await fetch(`${baseUrl}/api/documents`, {
    method: 'POST', headers: { cookie }, body: form,
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

test('رفع الملفات القابلة للتنفيذ في المتصفح مرفوض', async () => {
  const cookie = await login('admin@test.sa');

  const html = await upload(cookie, 'evil.html', 'text/html', '<script>alert(1)</script>');
  assert.strictEqual(html.status, 400, 'HTML مرفوض');

  const svg = await upload(cookie, 'evil.svg', 'image/svg+xml', '<svg onload="alert(1)"/>');
  assert.strictEqual(svg.status, 400, 'SVG مرفوض');

  const script = await upload(cookie, 'evil.js', 'application/javascript', 'alert(1)');
  assert.strictEqual(script.status, 400, 'جافاسكربت مرفوض');

  const pdf = await upload(cookie, 'ok.pdf', 'application/pdf', '%PDF-1.4 test');
  assert.strictEqual(pdf.status, 201, 'PDF مقبول');
});

test('تنزيل المستند يُجبر التحميل ولا يُعرض داخل المتصفح', async () => {
  const cookie = await login('admin@test.sa');
  const doc = db.get('SELECT id FROM documents ORDER BY id DESC LIMIT 1');

  const response = await fetch(`${baseUrl}/api/documents/${doc.id}/download`, { headers: { cookie } });
  assert.strictEqual(response.status, 200);
  assert.match(response.headers.get('content-disposition') || '', /attachment/i,
    'يجب أن يُنزَّل الملف لا أن يُعرض');
});

// --------------------------------------------------- حدود المدخلات

test('محاولات الدخول الفاشلة محدودة', async () => {
  const attempt = () => fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'ratelimit@test.sa', password: 'wrong' }),
  }).then((r) => r.status);

  let locked = false;
  for (let i = 0; i < 12; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const status = await attempt();
    if (status === 400) { locked = true; break; }
  }
  assert.ok(locked, 'يجب إيقاف المحاولات بعد تكرار الفشل');
});

test('واجهة الربط لا تقبل جلسة المستخدم، والجلسة لا تقبل مفتاحاً', async () => {
  const cookie = await login('admin@test.sa');

  const apiWithSession = await fetch(`${baseUrl}/api/v1/employees`, { headers: { cookie } });
  assert.strictEqual(apiWithSession.status, 401, 'واجهة الربط تتطلّب مفتاحاً');

  const portalWithKey = await fetch(`${baseUrl}/api/employees`, {
    headers: { authorization: 'Bearer mdd_test_whatever' },
  });
  assert.strictEqual(portalWithKey.status, 401, 'مسارات البوابة تتطلّب جلسة');
});

test('المسار غير الموجود لا يكشف تفاصيل داخلية', async () => {
  const cookie = await login('admin@test.sa');
  const result = await call('GET', '/api/does-not-exist', cookie);

  assert.strictEqual(result.status, 404);
  assert.ok(!/at .*\.js:\d+/.test(result.text), 'لا يُعاد أثر التنفيذ');
});
