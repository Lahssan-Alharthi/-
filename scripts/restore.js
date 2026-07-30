'use strict';

/**
 * استعادة نسخة احتياطية.
 *
 *   npm run restore -- <مجلد-النسخة>          فحص النسخة وعرض ما سيحدث
 *   npm run restore -- <مجلد-النسخة> --yes    تنفيذ الاستعادة فعلياً
 *
 * الاستعادة تستبدل قاعدة البيانات والمرفقات الحالية، فتُطلب موافقة صريحة،
 * وتُحفظ نسخة أمان من الحالة الحالية قبل الاستبدال حتى يمكن التراجع.
 *
 * ⚠️ أوقف الخادم قبل الاستعادة حتى لا يكتب على قاعدة بيانات مستبدلة.
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const config = {
  dbFile: process.env.DB_FILE || path.join(ROOT, 'data', 'madad.db'),
  uploadsDir: process.env.UPLOADS_DIR || path.join(ROOT, 'data', 'uploads'),
};

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
};

const say = (text) => process.stdout.write(`${text}\n`);
const ok = (text) => say(`  ${C.green}✓${C.reset} ${text}`);
const warn = (text) => say(`  ${C.yellow}!${C.reset} ${text}`);
const fail = (text) => say(`  ${C.red}✗${C.reset} ${text}`);

const CORE_TABLES = ['employees', 'attendance', 'leaves', 'payroll_runs', 'payslips',
  'loans', 'end_of_service', 'trips', 'vehicles', 'documents', 'audit_logs'];

/** طابع زمني بصيغة YYYYMMDD-HHMMSS. */
function timestamp() {
  const iso = new Date().toISOString();       // 2026-07-30T13:30:59.123Z
  return `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`;
}

function tableCounts(dbFile) {
  if (!fs.existsSync(dbFile)) return null;
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const existing = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name),
    );
    const counts = {};
    CORE_TABLES.filter((t) => existing.has(t)).forEach((table) => {
      counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    });
    return counts;
  } finally {
    db.close();
  }
}

function verifyDatabase(dbFile) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    return Object.values(db.prepare('PRAGMA integrity_check').get())[0] === 'ok';
  } finally {
    db.close();
  }
}

function run() {
  const argv = process.argv.slice(2);
  const source = argv.find((a) => !a.startsWith('--'));
  const confirmed = argv.includes('--yes');

  if (!source) {
    fail('حدّد مجلد النسخة: npm run restore -- <مجلد-النسخة> [--yes]');
    process.exit(1);
  }

  const backupDir = path.resolve(source);
  const backupDb = path.join(backupDir, 'madad.db');
  const backupUploads = path.join(backupDir, 'uploads');

  say(`${C.bold}استعادة نسخة احتياطية${C.reset}`);
  say(`${C.dim}من: ${backupDir}${C.reset}`);
  say(`${C.dim}إلى: ${config.dbFile}${C.reset}\n`);

  if (!fs.existsSync(backupDb)) {
    fail(`ملف قاعدة البيانات غير موجود في النسخة: ${backupDb}`);
    process.exit(1);
  }

  // 1) فحص النسخة قبل لمس أي شيء
  if (!verifyDatabase(backupDb)) {
    fail('النسخة تالفة (فشل integrity_check) — أُلغيت الاستعادة');
    process.exit(1);
  }
  ok('فحص سلامة النسخة');

  const backupCounts = tableCounts(backupDb);
  const currentCounts = tableCounts(config.dbFile);

  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(path.join(backupDir, 'manifest.json'), 'utf8')); } catch { /* اختيارية */ }
  if (manifest) ok(`بيان النسخة: أُخذت في ${manifest.created_at}`);
  else warn('لا يوجد manifest.json — يُكتفى بالفحص المباشر');

  // 2) عرض أثر الاستعادة على كل جدول
  say(`\n${C.bold}أثر الاستعادة:${C.reset}`);
  const tables = [...new Set([...Object.keys(backupCounts), ...Object.keys(currentCounts || {})])];
  tables.forEach((table) => {
    const before = currentCounts ? (currentCounts[table] ?? 0) : 0;
    const after = backupCounts[table] ?? 0;
    const arrow = before === after ? '=' : (after > before ? '↑' : '↓');
    const colour = before === after ? C.dim : (after < before ? C.yellow : C.green);
    say(`  ${colour}${table.padEnd(16)} ${before} ${arrow} ${after}${C.reset}`);
  });

  if (!confirmed) {
    say(`\n${C.yellow}${C.bold}عرض فقط — لم يُغيَّر شيء.${C.reset}`);
    say(`${C.dim}للتنفيذ أضف --yes، وأوقف الخادم أولاً.${C.reset}\n`);
    return;
  }

  // 3) نسخة أمان من الحالة الحالية قبل الاستبدال
  const safetyDir = path.join(path.dirname(config.dbFile), 'before-restore', timestamp());

  if (fs.existsSync(config.dbFile)) {
    fs.mkdirSync(safetyDir, { recursive: true });
    const safetyDb = path.join(safetyDir, 'madad.db');
    const current = new DatabaseSync(config.dbFile, { readOnly: true });
    try {
      current.exec(`VACUUM INTO '${safetyDb.replace(/'/g, "''")}'`);
    } finally {
      current.close();
    }
    if (fs.existsSync(config.uploadsDir)) {
      fs.cpSync(config.uploadsDir, path.join(safetyDir, 'uploads'), { recursive: true });
    }
    ok(`نسخة أمان من الحالة الحالية: ${safetyDir}`);
  }

  // 4) الاستبدال
  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
  ['-wal', '-shm'].forEach((suffix) => {
    const file = `${config.dbFile}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  });
  fs.copyFileSync(backupDb, config.dbFile);
  ok('استُعيدت قاعدة البيانات');

  if (fs.existsSync(backupUploads)) {
    fs.rmSync(config.uploadsDir, { recursive: true, force: true });
    fs.cpSync(backupUploads, config.uploadsDir, { recursive: true });
    ok(`استُعيدت المرفقات (${fs.readdirSync(config.uploadsDir).length} ملف)`);
  }

  // 5) تحقّق بعد الاستعادة
  const restored = tableCounts(config.dbFile);
  const mismatch = Object.keys(backupCounts)
    .filter((table) => backupCounts[table] !== restored[table]);

  if (mismatch.length) {
    fail(`اختلاف بعد الاستعادة: ${mismatch.join('، ')}`);
    process.exit(1);
  }
  ok('مطابقة الصفوف بعد الاستعادة');

  say(`\n${C.green}${C.bold}اكتملت الاستعادة.${C.reset}`);
  say(`${C.dim}شغّل الخادم: npm start${C.reset}\n`);
}

run();
