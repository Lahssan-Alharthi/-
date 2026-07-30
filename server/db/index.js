'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
fs.mkdirSync(config.uploadsDir, { recursive: true });

const db = new DatabaseSync(config.dbFile);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

/**
 * أعمدة أُضيفت بعد الإصدار الأول. تُطبَّق على قواعد البيانات القائمة
 * لأن CREATE TABLE IF NOT EXISTS لا يعدّل جدولاً موجوداً.
 */
const ADDED_COLUMNS = [
  ['payslips', 'gosi_employer', 'REAL NOT NULL DEFAULT 0'],
  ['payslips', 'gosi_total', 'REAL NOT NULL DEFAULT 0'],
  ['payslips', 'gosi_category', 'TEXT'],
  ['payslips', 'gosi_wage', 'REAL NOT NULL DEFAULT 0'],
  ['payroll_runs', 'total_gosi_employer', 'REAL NOT NULL DEFAULT 0'],
  ['employees', 'gosi_join_date', 'TEXT'],
  ['payslips', 'gosi_tier', 'TEXT'],
];

/** يضيف عموداً إلى جدول قائم إن لم يكن موجوداً. */
function ensureColumn(table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all()
    .some((row) => row.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/** ينشئ الجداول إن لم تكن موجودة، ثم يطبّق الترقيات التدريجية. */
function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  ADDED_COLUMNS.forEach((args) => ensureColumn(...args));
}

/** يحوّل كائنات SQLite (null-prototype) إلى كائنات عادية. */
function plain(row) {
  return row ? { ...row } : row;
}

const query = {
  all(sql, params = []) {
    return db.prepare(sql).all(...params).map(plain);
  },
  get(sql, params = []) {
    return plain(db.prepare(sql).get(...params));
  },
  run(sql, params = []) {
    return db.prepare(sql).run(...params);
  },
  /** ينفّذ دالة داخل معاملة واحدة. */
  transaction(fn) {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  },
};

module.exports = { db, migrate, ...query };
