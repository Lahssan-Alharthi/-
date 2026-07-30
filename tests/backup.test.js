'use strict';

/**
 * اختبار دورة النسخ الاحتياطي والاستعادة.
 * نسخة احتياطية لا تُختبر استعادتها ليست نسخة احتياطية.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { DatabaseSync } = require('node:sqlite');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'madad-backup-'));
const dbFile = path.join(workDir, 'madad.db');
const uploadsDir = path.join(workDir, 'uploads');
const backupsDir = path.join(workDir, 'backups');

const ROOT = path.resolve(__dirname, '..');
const env = { ...process.env, DB_FILE: dbFile, UPLOADS_DIR: uploadsDir, NODE_ENV: 'test' };

/** يشغّل أداة النسخ أو الاستعادة ويعيد مخرجاتها. */
function runScript(script, args) {
  return execFileSync('node', [path.join(ROOT, 'scripts', script), ...args], {
    env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function counts(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return {
      employees: db.prepare('SELECT COUNT(*) AS n FROM employees').get().n,
      attendance: db.prepare('SELECT COUNT(*) AS n FROM attendance').get().n,
    };
  } finally {
    db.close();
  }
}

test.before(() => {
  fs.mkdirSync(uploadsDir, { recursive: true });

  // قاعدة بيانات مصغّرة ببنية البوابة
  const schema = fs.readFileSync(path.join(ROOT, 'server', 'db', 'schema.sql'), 'utf8');
  const db = new DatabaseSync(dbFile);
  db.exec(schema);

  const insert = db.prepare(
    `INSERT INTO employees (employee_no, full_name_ar, email, password_hash, basic_salary)
     VALUES (?, ?, ?, 'x', 5000)`,
  );
  for (let i = 1; i <= 12; i += 1) {
    insert.run(String(1000 + i), `موظف ${i}`, `emp${i}@test.sa`);
  }

  const attendance = db.prepare(
    "INSERT INTO attendance (employee_id, date, check_in, status) VALUES (?, ?, '08:00', 'present')",
  );
  for (let e = 1; e <= 12; e += 1) {
    for (let d = 1; d <= 5; d += 1) {
      attendance.run(e, `2026-03-0${d}`);
    }
  }
  db.close();

  fs.writeFileSync(path.join(uploadsDir, 'doc-1.txt'), 'مستند تجريبي', 'utf8');
  fs.writeFileSync(path.join(uploadsDir, 'doc-2.txt'), 'مستند آخر', 'utf8');
});

test.after(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

test('النسخة الاحتياطية تُنشأ وتُتحقّق من سلامتها', () => {
  const output = runScript('backup.js', ['--out', backupsDir]);

  assert.match(output, /فحص السلامة/);
  assert.match(output, /مطابقة الصفوف/);
  assert.match(output, /اكتملت النسخة/);

  const backups = fs.readdirSync(backupsDir).filter((n) => n.startsWith('madad-'));
  assert.strictEqual(backups.length, 1);

  const dir = path.join(backupsDir, backups[0]);
  assert.ok(fs.existsSync(path.join(dir, 'madad.db')), 'ملف قاعدة البيانات موجود');
  assert.ok(fs.existsSync(path.join(dir, 'manifest.json')), 'بيان النسخة موجود');
  assert.strictEqual(fs.readdirSync(path.join(dir, 'uploads')).length, 2, 'المرفقات منسوخة');

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.strictEqual(manifest.counts.employees, 12);
  assert.strictEqual(manifest.counts.attendance, 60);
  assert.strictEqual(manifest.verified, true);

  // اسم المجلد بصيغة صحيحة قابلة للفرز
  assert.match(backups[0], /^madad-\d{8}-\d{6}$/);
});

test('النسخة تحمل بيانات مطابقة للأصل ويمكن فتحها مستقلة', () => {
  const dir = path.join(backupsDir, fs.readdirSync(backupsDir).filter((n) => n.startsWith('madad-'))[0]);
  assert.deepStrictEqual(counts(path.join(dir, 'madad.db')), counts(dbFile));
});

test('العرض بلا --yes لا يغيّر شيئاً', () => {
  const dir = path.join(backupsDir, fs.readdirSync(backupsDir).filter((n) => n.startsWith('madad-'))[0]);

  // كارثة: حذف أغلب البيانات
  const db = new DatabaseSync(dbFile);
  db.exec('DELETE FROM employees WHERE id > 3');
  db.close();
  const damaged = counts(dbFile);
  assert.strictEqual(damaged.employees, 3);

  const output = runScript('restore.js', [dir]);
  assert.match(output, /عرض فقط/);
  assert.match(output, /employees\s+3\s+↑\s+12/, 'يعرض الأثر قبل التنفيذ');

  assert.deepStrictEqual(counts(dbFile), damaged, 'لم تتغيّر البيانات');
});

test('الاستعادة تُرجع البيانات والمرفقات وتحفظ نسخة أمان', () => {
  const dir = path.join(backupsDir, fs.readdirSync(backupsDir).filter((n) => n.startsWith('madad-'))[0]);

  fs.rmSync(uploadsDir, { recursive: true, force: true });
  fs.mkdirSync(uploadsDir, { recursive: true });

  const output = runScript('restore.js', [dir, '--yes']);
  assert.match(output, /نسخة أمان من الحالة الحالية/);
  assert.match(output, /مطابقة الصفوف بعد الاستعادة/);
  assert.match(output, /اكتملت الاستعادة/);

  assert.strictEqual(counts(dbFile).employees, 12, 'استُعيد الموظفون');
  assert.strictEqual(counts(dbFile).attendance, 60, 'استُعيد الحضور');
  assert.strictEqual(fs.readdirSync(uploadsDir).length, 2, 'استُعيدت المرفقات');
  assert.strictEqual(
    fs.readFileSync(path.join(uploadsDir, 'doc-1.txt'), 'utf8'), 'مستند تجريبي',
    'محتوى المرفق سليم',
  );

  // نسخة الأمان تتيح التراجع عن الاستعادة نفسها
  const safety = path.join(workDir, 'before-restore');
  assert.ok(fs.existsSync(safety));
  const snapshot = fs.readdirSync(safety)[0];
  assert.strictEqual(counts(path.join(safety, snapshot, 'madad.db')).employees, 3,
    'نسخة الأمان تحمل الحالة التالفة قبل الاستعادة');
});

test('الاستعادة من نسخة تالفة تُرفض قبل لمس البيانات', () => {
  const brokenDir = path.join(workDir, 'broken');
  fs.mkdirSync(brokenDir, { recursive: true });
  fs.writeFileSync(path.join(brokenDir, 'madad.db'), 'ليست قاعدة بيانات', 'utf8');

  const before = counts(dbFile);
  assert.throws(() => runScript('restore.js', [brokenDir, '--yes']),
    /Command failed/, 'يجب أن تفشل الاستعادة');
  assert.deepStrictEqual(counts(dbFile), before, 'البيانات الحالية سليمة');
});

test('الاحتفاظ يحذف النسخ الزائدة ويبقي الأحدث', () => {
  // ثلاث نسخ إضافية بطوابع زمنية مختلفة
  const extra = ['madad-20200101-000001', 'madad-20200101-000002', 'madad-20200101-000003'];
  extra.forEach((name) => {
    const dir = path.join(backupsDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{"counts":{"employees":0}}', 'utf8');
  });

  runScript('backup.js', ['--out', backupsDir, '--keep', '2']);

  const remaining = fs.readdirSync(backupsDir).filter((n) => n.startsWith('madad-')).sort();
  assert.strictEqual(remaining.length, 2, 'يبقى عدد الاحتفاظ فقط');
  assert.ok(!remaining.includes('madad-20200101-000001'), 'حُذفت الأقدم');

  const listing = runScript('backup.js', ['--out', backupsDir, '--list']);
  assert.match(listing, /النسخ الاحتياطية/);
});
