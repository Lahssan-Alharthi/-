'use strict';

const db = require('../db');

/** يسجّل حدثاً في سجل النشاط. */
function log(req, action, entity, entityId, details) {
  const actorId = req && req.user ? req.user.id : null;
  const ip = req ? (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim() : null;

  db.run(
    `INSERT INTO audit_logs (actor_id, action, entity, entity_id, details, ip)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [actorId, action, entity || null, entityId || null,
      details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null, ip],
  );
}

module.exports = { log };
