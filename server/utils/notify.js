'use strict';

const db = require('../db');

/** ينشئ إشعاراً لموظف واحد. */
function push(employeeId, title, body, link) {
  if (!employeeId) return;
  db.run(
    'INSERT INTO notifications (employee_id, title, body, link) VALUES (?, ?, ?, ?)',
    [employeeId, title, body || null, link || null],
  );
}

/** ينشئ الإشعار نفسه لمجموعة موظفين. */
function pushMany(employeeIds, title, body, link) {
  const unique = [...new Set((employeeIds || []).filter(Boolean))];
  unique.forEach((id) => push(id, title, body, link));
}

/** إشعار لكل من يحمل أحد الأدوار المحددة. */
function pushToRoles(roles, title, body, link) {
  const placeholders = roles.map(() => '?').join(',');
  const rows = db.all(
    `SELECT id FROM employees WHERE role IN (${placeholders}) AND status = 'active'`,
    roles,
  );
  pushMany(rows.map((r) => r.id), title, body, link);
}

module.exports = { push, pushMany, pushToRoles };
