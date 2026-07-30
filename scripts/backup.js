'use strict';

/**
 * نسخة احتياطية من قاعدة البيانات والمرفقات.
 *
 *   npm run backup                 نسخة جديدة مع التحقّق من سلامتها
 *   npm run backup -- --list       عرض النسخ المتاحة
 *   npm run backup -- --keep 30    الاحتفاظ بآخر 30 نسخة (10 افتراضياً)
 *   npm run backup -- --out /path  مجلد وجهة مختلف
 *
 * تُؤخذ نسخة قاعدة البيانات بـ VACUUM INTO فتكون لقطة متّسقة حتى والخادم
 * يعمل، ثم يُتحقّق من سلامتها بفتحها وفحصها قبل اعتمادها.
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// تُقرأ المسارات مباشرةً لا عبر إعدادات التطبيق، حتى تعمل أداة النسخ
// والاستعادة في بيئة الطوارئ دون اشتراط متغيّرات تشغيل الخادم
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

/** الجداول التي تُحصى للتحقّق من اكتمال النسخة. */
const CORE_TABLES = ['employees', 'attendance', 'leaves', 'payroll_runs', 'payslips',
  'loans', 'end_of_service', 'trips', 'vehicles', 'documents', 'audit_logs'];

/** طابع زمني بصيغة YYYYMMDD-HHMMSS. */
function timestamp() {
  const iso = new Date().toISOString();       // 2026-07-30T13:30:59.123Z
  return `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`;
}

/**
 * مسار نسخة غير مستخدم. دقّة الطابع الزمني ثانية واحدة، فنسختان في
 * الثانية نفسها (إعادة تشغيل يدوي أو تكرار مهمة مجدولة) تتزاحمان على
 * الاسم نفسه — تُضاف لاحقة عندئذٍ بدل أن يفشل الأمر.
 */
function uniqueTarget(root, stamp) {
  const base = path.join(root, `madad-${stamp}`);
  if (!fs.existsSync(base)) return base;

  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('تعذّر إيجاد اسم نسخة متاح — انتظر ثانية وأعد المحاولة');
}

function parseArgs(argv) {
  const args = { keep: 10, list: false, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--list') args.list = true;
    if (argv[i] === '--keep') args.keep = Math.max(1, Number(argv[i + 1]) || 10);
    if (argv[i] === '--out') args.out = argv[i + 1];
  }
  return args;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} كيلوبايت`;
  return `${(bytes / 1024 / 1024).toFixed(2)} ميجابايت`;
}

/** يحصي صفوف الجداول الأساسية في ملف قاعدة بيانات. */
function tableCounts(dbFile) {
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

/** يتحقّق من سلامة ملف قاعدة البيانات. */
function verifyDatabase(dbFile) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const result = db.prepare('PRAGMA integrity_check').get();
    return Object.values(result)[0] === 'ok';
  } finally {
    db.close();
  }
}

function listBackups(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((name) => /^madad-\d{8}-\d{6}(-\d+)?$/.test(name))
    .sort()
    .map((name) => {
      const dir = path.join(root, name);
      const manifestFile = path.join(dir, 'manifest.json');
      let manifest = null;
      try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { /* ناقصة */ }
      return { name, dir, manifest };
    });
}

/** الحجم الكلي لمجلد. */
function directorySize(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => {
    const full = path.join(dir, entry.name);
    return sum + (entry.isDirectory() ? directorySize(full) : fs.statSync(full).size);
  }, 0);
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const root = args.out || path.join(path.dirname(config.dbFile), 'backups');

  if (args.list) {
    const backups = listBackups(root);
    say(`${C.bold}النسخ الاحتياطية في ${root}${C.reset}`);
    if (!backups.length) { warn('لا توجد نسخ بعد'); return; }
    backups.reverse().forEach(({ name, dir, manifest }) => {
      const size = formatSize(directorySize(dir));
      const employees = manifest && manifest.counts ? manifest.counts.employees : '؟';
      say(`  ${name}  ${C.dim}${size} — ${employees} موظف${C.reset}`);
    });
    return;
  }

  if (!fs.existsSync(config.dbFile)) {
    fail(`قاعدة البيانات غير موجودة: ${config.dbFile}`);
    process.exit(1);
  }

  fs.mkdirSync(root, { recursive: true });
  const target = uniqueTarget(root, timestamp());

  say(`${C.bold}نسخة احتياطية — بوابة موظفي شركة مدد${C.reset}`);
  say(`${C.dim}المصدر: ${config.dbFile}${C.reset}`);
  say(`${C.dim}الوجهة: ${target}${C.reset}\n`);

  fs.mkdirSync(target, { recursive: true });

  // 1) لقطة متّسقة من قاعدة البيانات حتى والخادم يعمل
  const dbCopy = path.join(target, 'madad.db');
  const source = new DatabaseSync(config.dbFile, { readOnly: true });
  try {
    source.exec(`VACUUM INTO '${dbCopy.replace(/'/g, "''")}'`);
  } finally {
    source.close();
  }
  ok(`نسخة قاعدة البيانات (${formatSize(fs.statSync(dbCopy).size)})`);

  // 2) التحقّق من سلامة النسخة قبل اعتمادها
  if (!verifyDatabase(dbCopy)) {
    fail('فحص السلامة فشل — النسخة غير صالحة، حُذفت');
    fs.rmSync(target, { recursive: true, force: true });
    process.exit(1);
  }
  ok('فحص السلامة (integrity_check)');

  // 3) مطابقة عدد الصفوف بين الأصل والنسخة
  const sourceCounts = tableCounts(config.dbFile);
  const copyCounts = tableCounts(dbCopy);
  const mismatch = Object.keys(sourceCounts)
    .filter((table) => sourceCounts[table] !== copyCounts[table]);

  if (mismatch.length) {
    fail(`اختلاف في عدد الصفوف: ${mismatch.join('، ')}`);
    fs.rmSync(target, { recursive: true, force: true });
    process.exit(1);
  }
  ok(`مطابقة الصفوف (${Object.keys(sourceCounts).length} جدول)`);

  // 4) المرفقات
  let uploadsCount = 0;
  if (fs.existsSync(config.uploadsDir)) {
    const uploadsCopy = path.join(target, 'uploads');
    fs.cpSync(config.uploadsDir, uploadsCopy, { recursive: true });
    uploadsCount = fs.readdirSync(uploadsCopy).length;
    ok(`المرفقات (${uploadsCount} ملف، ${formatSize(directorySize(uploadsCopy))})`);
  } else {
    warn('لا يوجد مجلد مرفقات');
  }

  // 5) بيان النسخة
  const manifest = {
    created_at: new Date().toISOString(),
    source_db: config.dbFile,
    node_version: process.version,
    counts: sourceCounts,
    uploads_files: uploadsCount,
    verified: true,
  };
  fs.writeFileSync(path.join(target, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  ok('بيان النسخة (manifest.json)');

  // 6) حذف النسخ القديمة
  const backups = listBackups(root);
  const excess = backups.slice(0, Math.max(0, backups.length - args.keep));
  excess.forEach(({ dir, name }) => {
    fs.rmSync(dir, { recursive: true, force: true });
    say(`  ${C.dim}حُذفت النسخة القديمة ${name}${C.reset}`);
  });

  const summary = Object.entries(sourceCounts)
    .map(([table, n]) => `${table}: ${n}`).join('، ');

  say(`\n${C.green}${C.bold}اكتملت النسخة: ${path.basename(target)}${C.reset}`);
  say(`${C.dim}${summary}${C.reset}`);
  say(`${C.dim}الاستعادة: npm run restore -- ${target} --yes${C.reset}\n`);
}

run();
