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

/** ينشئ الجداول إن لم تكن موجودة. */
function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
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
