'use strict';

/**
 * اختبارات دفع الأحداث (Webhooks) والنسب التدريجية للتأمينات.
 * تُستخدم خادم استقبال محلي للتحقّق من التسليم والتوقيع.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'madad-hooks-'));
process.env.DB_FILE = path.join(workDir, 'hooks.db');
process.env.UPLOADS_DIR = path.join(workDir, 'uploads');
process.env.JWT_SECRET = 'test-secret-hooks';
process.env.NODE_ENV = 'test';

const db = require('../server/db');
const app = require('../server/index');
const config = require('../server/config');
const hooks = require('../server/utils/webhooks');
const { computeGosi, saudiRates } = require('../server/utils/gosi');
const { hashPassword } = require('../server/utils/password');

let server;
let baseUrl;
let receiver;
let receiverUrl;

/** الطلبات التي وصلت إلى الخادم المستقبِل. */
let received = [];
/** ما يجيب به المستقبِل: { status, delayMs }. */
let behaviour = { status: 200 };

const PASSWORD = 'Test@1234';

function startReceiver() {
  return new Promise((resolve) => {
    receiver = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        received.push({
          path: req.url,
          event: req.headers['x-madad-event'],
          signature: req.headers['x-madad-signature'],
          timestamp: req.headers['x-madad-timestamp'],
          attempt: Number(req.headers['x-madad-attempt']),
          body,
        });

        const respond = () => {
          res.writeHead(behaviour.status, { 'Content-Type': 'text/plain' });
          res.end('ok');
        };
        if (behaviour.delayMs) setTimeout(respond, behaviour.delayMs);
        else respond();
      });
    });
    receiver.listen(0, '127.0.0.1', () => {
      receiverUrl = `http://127.0.0.1:${receiver.address().port}/hook`;
      resolve();
    });
  });
}

async function login(email) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  assert.strictEqual(response.status, 200, `فشل الدخول: ${email}`);
  return response.headers.getSetCookie()[0].split(';')[0];
}

function request(method, urlPath, cookie, body) {
  return fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (response) => ({ status: response.status, body: await response.json().catch(() => null) }));
}

/** ينتظر حتى يصل عدد محدّد من الطلبات أو تنتهي المهلة. */
async function waitFor(count, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (received.length < count && Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return received.length >= count;
}

const ids = {};

test.before(async () => {
  db.migrate();
  await startReceiver();

  db.run("INSERT INTO departments (code, name_ar) VALUES ('OPS', 'العمليات')");
  db.run(`INSERT INTO leave_types (code, name_ar, max_days, paid, deducts_balance, requires_attachment)
          VALUES ('ANNUAL', 'إجازة سنوية', 30, 1, 1, 0)`);

  const insert = (no, name, email, role, extra) => {
    const fields = {
      employee_no: no, full_name_ar: name, email, role,
      password_hash: hashPassword(PASSWORD), status: 'active',
      basic_salary: 9000, housing_allowance: 2250, nationality: 'سعودي',
      hire_date: '2020-01-01', annual_leave_balance: 30, ...(extra || {}),
    };
    const cols = Object.keys(fields);
    const info = db.run(
      `INSERT INTO employees (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
      cols.map((c) => fields[c]),
    );
    return Number(info.lastInsertRowid);
  };

  ids.admin = insert('9001', 'مدير النظام', 'admin@test.sa', 'admin');
  ids.manager = insert('9002', 'مدير مباشر', 'mgr@test.sa', 'manager');
  ids.employee = insert('9003', 'موظف', 'emp@test.sa', 'employee', { manager_id: null });
  db.run('UPDATE employees SET manager_id = ? WHERE id = ?', [ids.manager, ids.employee]);

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  hooks.cancelPending();
  if (server) server.close();
  if (receiver) receiver.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

test.beforeEach(() => {
  received = [];
  behaviour = { status: 200 };
});

// ------------------------------------------------------ إدارة الاشتراكات

test('إدارة الاشتراكات مقصورة على مدير النظام', async () => {
  const managerCookie = await login('mgr@test.sa');
  const denied = await request('GET', '/api/webhooks', managerCookie);
  assert.strictEqual(denied.status, 403);

  const adminCookie = await login('admin@test.sa');
  const allowed = await request('GET', '/api/webhooks', adminCookie);
  assert.strictEqual(allowed.status, 200);
});

test('الروابط غير الصالحة مرفوضة', async () => {
  const cookie = await login('admin@test.sa');

  const bad = await request('POST', '/api/webhooks', cookie,
    { name: 'رابط خاطئ', url: 'ليس رابطاً', events: ['leave.decided'] });
  assert.strictEqual(bad.status, 400);

  const wrongProtocol = await request('POST', '/api/webhooks', cookie,
    { name: 'بروتوكول خاطئ', url: 'ftp://example.com/x', events: ['leave.decided'] });
  assert.strictEqual(wrongProtocol.status, 400);

  const noEvents = await request('POST', '/api/webhooks', cookie,
    { name: 'بلا أحداث', url: receiverUrl, events: [] });
  assert.strictEqual(noEvents.status, 400);
});

test('عناوين الشبكة الداخلية تُرفض في بيئة الإنتاج فقط', async () => {
  // في بيئة الاختبار مسموح بها لتجربة الربط محلياً
  assert.strictEqual(hooks.validateUrl('http://127.0.0.1:9999/hook'), null);

  const original = config.env;
  config.env = 'production';
  try {
    assert.match(hooks.validateUrl('http://127.0.0.1:9999/hook'), /الداخلية|HTTPS/);
    assert.match(hooks.validateUrl('http://192.168.1.10/hook'), /الداخلية|HTTPS/);
    assert.match(hooks.validateUrl('http://example.com/hook'), /HTTPS/);
    assert.strictEqual(hooks.validateUrl('https://erp.example.com/hook'), null);
  } finally {
    config.env = original;
  }
});

test('إنشاء اشتراك يعيد السر مرة واحدة ولا يخزّنه في القائمة', async () => {
  const cookie = await login('admin@test.sa');
  const created = await request('POST', '/api/webhooks', cookie, {
    name: 'اشتراك السر', url: receiverUrl, events: ['leave.decided'],
  });

  assert.strictEqual(created.status, 201);
  assert.ok(created.body.secret.startsWith('whsec_'));

  const list = await request('GET', '/api/webhooks', cookie);
  const row = list.body.data.find((w) => w.name === 'اشتراك السر');
  assert.strictEqual(row.secret, undefined, 'القائمة لا تُعيد السر');

  await request('DELETE', `/api/webhooks/${row.id}`, cookie);
});

// -------------------------------------------------------- التسليم والتوقيع

test('الحدث التجريبي يُسلَّم موقّعاً بتوقيع يمكن التحقّق منه', async () => {
  const cookie = await login('admin@test.sa');
  const created = await request('POST', '/api/webhooks', cookie, {
    name: 'اشتراك التوقيع', url: receiverUrl, events: ['attendance.recorded'],
  });
  const secret = created.body.secret;
  const id = created.body.data.id;

  const result = await request('POST', `/api/webhooks/${id}/test`, cookie, {});
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.ok, true);
  assert.strictEqual(result.body.status_code, 200);

  assert.strictEqual(received.length, 1);
  const delivery = received[0];
  assert.strictEqual(delivery.event, 'attendance.recorded');

  // التحقّق من التوقيع كما يفعله النظام المستقبِل
  const expected = crypto.createHmac('sha256', secret)
    .update(`${delivery.timestamp}.${delivery.body}`).digest('hex');
  assert.strictEqual(delivery.signature, `sha256=${expected}`);

  // سر مختلف يجب أن يعطي توقيعاً مختلفاً
  const wrong = crypto.createHmac('sha256', 'whsec_wrong')
    .update(`${delivery.timestamp}.${delivery.body}`).digest('hex');
  assert.notStrictEqual(delivery.signature, `sha256=${wrong}`);

  await request('DELETE', `/api/webhooks/${id}`, cookie);
});

test('اعتماد الإجازة يدفع حدثاً يحمل بيانات الطلب', async () => {
  const adminCookie = await login('admin@test.sa');
  const created = await request('POST', '/api/webhooks', adminCookie, {
    name: 'اشتراك الإجازات', url: receiverUrl, events: ['leave.requested', 'leave.decided'],
  });
  const id = created.body.data.id;

  const employeeCookie = await login('emp@test.sa');
  const leave = await request('POST', '/api/leaves', employeeCookie, {
    leave_type_id: db.get("SELECT id FROM leave_types WHERE code = 'ANNUAL'").id,
    start_date: '2027-02-10',
    end_date: '2027-02-12',
    reason: 'سفر',
  });
  assert.strictEqual(leave.status, 201);

  assert.ok(await waitFor(1), 'يجب وصول حدث تقديم الطلب');
  const requestedEvent = JSON.parse(received[0].body);
  assert.strictEqual(requestedEvent.event, 'leave.requested');
  assert.strictEqual(requestedEvent.data.employee_no, '9003');
  assert.strictEqual(requestedEvent.data.days, 3);

  const managerCookie = await login('mgr@test.sa');
  const decision = await request('POST', `/api/leaves/${leave.body.data.id}/decision`,
    managerCookie, { decision: 'approved' });
  assert.strictEqual(decision.status, 200);

  assert.ok(await waitFor(2), 'يجب وصول حدث القرار');
  const decidedEvent = JSON.parse(received[1].body);
  assert.strictEqual(decidedEvent.event, 'leave.decided');
  assert.strictEqual(decidedEvent.data.decision, 'approved');
  assert.strictEqual(decidedEvent.data.employee_no, '9003');

  await request('DELETE', `/api/webhooks/${id}`, adminCookie);
});

test('الاشتراك لا يستقبل إلا الأحداث المشترَك فيها', async () => {
  const cookie = await login('admin@test.sa');
  const created = await request('POST', '/api/webhooks', cookie, {
    name: 'اشتراك الرواتب فقط', url: receiverUrl, events: ['payroll.approved'],
  });
  const id = created.body.data.id;

  // حدث حضور — ليس ضمن الاشتراك
  const employeeCookie = await login('emp@test.sa');
  await request('POST', '/api/attendance/check-in', employeeCookie);

  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.strictEqual(received.length, 0, 'لا يجب تسليم حدث غير مشترَك فيه');

  await request('DELETE', `/api/webhooks/${id}`, cookie);
});

test('الاشتراك الموقوف لا يستقبل أحداثاً', async () => {
  const cookie = await login('admin@test.sa');
  const created = await request('POST', '/api/webhooks', cookie, {
    name: 'اشتراك موقوف', url: receiverUrl, events: ['attendance.recorded'],
  });
  const id = created.body.data.id;

  await request('PUT', `/api/webhooks/${id}`, cookie, { is_active: false });

  const employeeCookie = await login('emp@test.sa');
  await request('POST', '/api/attendance/check-out', employeeCookie);

  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.strictEqual(received.length, 0);

  await request('DELETE', `/api/webhooks/${id}`, cookie);
});

test('أخطاء العميل (4xx) لا تُعاد المحاولة فيها، ويُسجَّل الفشل', async () => {
  const cookie = await login('admin@test.sa');
  const created = await request('POST', '/api/webhooks', cookie, {
    name: 'اشتراك يرفض', url: receiverUrl, events: ['attendance.recorded'],
  });
  const id = created.body.data.id;

  behaviour = { status: 400 };
  const result = await request('POST', `/api/webhooks/${id}/test`, cookie, {});

  assert.strictEqual(result.body.ok, false);
  assert.strictEqual(result.body.status_code, 400);
  assert.strictEqual(received.length, 1, 'لا تُعاد المحاولة على خطأ 4xx');

  const deliveries = await request('GET', `/api/webhooks/${id}/deliveries`, cookie);
  assert.strictEqual(deliveries.body.data.length, 1);
  assert.strictEqual(deliveries.body.data[0].status_code, 400);

  const list = await request('GET', '/api/webhooks', cookie);
  assert.strictEqual(list.body.data.find((w) => w.id === id).failure_streak, 1);

  await request('DELETE', `/api/webhooks/${id}`, cookie);
});

test('تعطّل التسليم المتكرّر يوقف الاشتراك تلقائياً', async () => {
  const cookie = await login('admin@test.sa');
  const created = await request('POST', '/api/webhooks', cookie, {
    name: 'اشتراك متعطّل', url: receiverUrl, events: ['attendance.recorded'],
  });
  const id = created.body.data.id;

  behaviour = { status: 400 };
  for (let i = 0; i < hooks.MAX_FAILURE_STREAK; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await request('POST', `/api/webhooks/${id}/test`, cookie, {});
  }

  const list = await request('GET', '/api/webhooks', cookie);
  const row = list.body.data.find((w) => w.id === id);
  assert.strictEqual(row.is_active, false, 'يجب إيقاف الاشتراك تلقائياً');
  assert.match(row.disabled_reason, /متتالية/);

  // إعادة التنشيط تصفّر العدّاد
  await request('PUT', `/api/webhooks/${id}`, cookie, { is_active: true });
  const after = await request('GET', '/api/webhooks', cookie);
  const revived = after.body.data.find((w) => w.id === id);
  assert.strictEqual(revived.is_active, true);
  assert.strictEqual(revived.failure_streak, 0);
  assert.strictEqual(revived.disabled_reason, null);

  await request('DELETE', `/api/webhooks/${id}`, cookie);
});

test('فشل الحدث لا يُفشل العملية الأصلية', async () => {
  const cookie = await login('admin@test.sa');
  const created = await request('POST', '/api/webhooks', cookie, {
    name: 'اشتراك معطوب', url: 'http://127.0.0.1:1/hook', events: ['trip.created'],
  });
  const id = created.body.data.id;

  // إنشاء رحلة يجب أن ينجح رغم أن الرابط لا يستجيب
  const trip = await request('POST', '/api/trips', cookie, {
    origin: 'الرياض', destination: 'جدة',
  });
  assert.strictEqual(trip.status, 201, 'العملية الأصلية يجب أن تنجح مهما فشل الحدث');

  await request('DELETE', `/api/webhooks/${id}`, cookie);
});

// -------------------------------------------- النسب التدريجية للتأمينات

test('النسب التدريجية معطّلة افتراضياً فتُطبَّق النسب الأساسية', () => {
  assert.strictEqual(config.payroll.gosi.progressive.enabled, false);

  const rates = saudiRates({ hire_date: '2025-01-01' }, 2026);
  assert.strictEqual(rates.tier, 'base');
  assert.strictEqual(rates.totalRate, 0.22);
  assert.strictEqual(rates.employeeRate, 0.10);
});

test('عند تفعيل التدرّج: المشترك القديم على النسب الأساسية والجديد على الجدول', () => {
  const progressive = config.payroll.gosi.progressive;
  progressive.enabled = true;
  try {
    // اشترك قبل تاريخ التعديل ⇽ النسب الأساسية
    const old = saudiRates({ hire_date: '2020-05-01' }, 2026);
    assert.strictEqual(old.tier, 'base');
    assert.strictEqual(old.employeeRate, 0.10);

    // اشترك بعد تاريخ التعديل ⇽ جدول 2026
    const fresh = saudiRates({ hire_date: '2025-03-01' }, 2026);
    assert.strictEqual(fresh.tier, 'progressive:2026');
    assert.strictEqual(fresh.totalRate, 0.21);
    assert.strictEqual(fresh.employeeRate, 0.095);

    // سنة بعد نهاية الجدول تأخذ آخر شريحة
    const later = saudiRates({ hire_date: '2025-03-01' }, 2040);
    assert.strictEqual(later.tier, 'progressive:2029');

    // gosi_join_date يتقدّم على تاريخ التعيين
    const explicit = saudiRates({ hire_date: '2025-03-01', gosi_join_date: '2019-01-01' }, 2026);
    assert.strictEqual(explicit.tier, 'base');

    // الحساب الكامل يعكس النسب التدريجية
    const slip = computeGosi(
      { nationality: 'سعودي', basic_salary: 9000, housing_allowance: 2250, hire_date: '2025-03-01' },
      2026,
    );
    assert.strictEqual(slip.contributory_wage, 11250);
    assert.strictEqual(slip.total_amount, 2362.5); // 21%
    assert.strictEqual(slip.employee_amount, 1068.75); // 9.5%
    assert.strictEqual(slip.employer_amount, 1293.75);
    assert.strictEqual(slip.tier, 'progressive:2026');
  } finally {
    progressive.enabled = false;
  }
});

test('غير السعودي لا يتأثّر بالنسب التدريجية', () => {
  const progressive = config.payroll.gosi.progressive;
  progressive.enabled = true;
  try {
    const slip = computeGosi(
      { nationality: 'مصري', basic_salary: 9000, housing_allowance: 2250, hire_date: '2025-03-01' },
      2026,
    );
    assert.strictEqual(slip.tier, 'occupational_hazards');
    assert.strictEqual(slip.total_amount, 225); // 2%
    assert.strictEqual(slip.employee_amount, 0);
  } finally {
    progressive.enabled = false;
  }
});
