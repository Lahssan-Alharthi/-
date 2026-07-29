'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler, badRequest, notFound, conflict } = require('../utils/http');
const { requireAuth, requirePermission } = require('../middleware/auth');
const audit = require('../utils/audit');

const router = express.Router();
router.use(requireAuth);

const SELECT_BASE = `
  SELECT d.*, m.full_name_ar AS manager_name,
         (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.id AND e.status = 'active') AS employees_count
    FROM departments d
    LEFT JOIN employees m ON m.id = d.manager_id`;

router.get('/', asyncHandler(async (req, res) => {
  res.json({ data: db.all(`${SELECT_BASE} ORDER BY d.name_ar`) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const row = db.get(`${SELECT_BASE} WHERE d.id = ?`, [Number(req.params.id)]);
  if (!row) throw notFound('القسم غير موجود');

  row.employees = db.all(
    `SELECT id, employee_no, full_name_ar, job_title, status
       FROM employees WHERE department_id = ? ORDER BY full_name_ar`,
    [row.id],
  );
  res.json({ data: row });
}));

router.post('/', requirePermission('departments:create'), asyncHandler(async (req, res) => {
  const { code, name_ar: nameAr } = req.body || {};
  if (!String(code || '').trim() || !String(nameAr || '').trim()) {
    throw badRequest('رمز القسم والاسم العربي حقلان إلزاميان');
  }
  if (db.get('SELECT id FROM departments WHERE code = ?', [code])) {
    throw conflict('رمز القسم مستخدم مسبقاً');
  }

  const info = db.run(
    `INSERT INTO departments (code, name_ar, name_en, description, manager_id, cost_center)
     VALUES (?,?,?,?,?,?)`,
    [String(code).trim(), String(nameAr).trim(), req.body.name_en || null,
      req.body.description || null,
      req.body.manager_id ? Number(req.body.manager_id) : null,
      req.body.cost_center || null],
  );

  const id = Number(info.lastInsertRowid);
  audit.log(req, 'create', 'departments', id, { code });
  res.status(201).json({ data: db.get(`${SELECT_BASE} WHERE d.id = ?`, [id]), message: 'تم إنشاء القسم' });
}));

router.put('/:id', requirePermission('departments:update'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!db.get('SELECT id FROM departments WHERE id = ?', [id])) throw notFound('القسم غير موجود');

  const fields = ['code', 'name_ar', 'name_en', 'description', 'manager_id', 'cost_center'];
  const updates = [];
  const params = [];

  fields.forEach((field) => {
    if (!(field in req.body)) return;
    let value = req.body[field];
    if (field === 'manager_id') value = value ? Number(value) : null;
    if (field === 'code') {
      const clash = db.get('SELECT id FROM departments WHERE code = ? AND id <> ?', [value, id]);
      if (clash) throw conflict('رمز القسم مستخدم مسبقاً');
    }
    updates.push(`${field} = ?`);
    params.push(value === '' ? null : value);
  });

  if (!updates.length) throw badRequest('لا توجد حقول للتعديل');

  db.run(`UPDATE departments SET ${updates.join(', ')} WHERE id = ?`, [...params, id]);
  audit.log(req, 'update', 'departments', id);
  res.json({ data: db.get(`${SELECT_BASE} WHERE d.id = ?`, [id]), message: 'تم حفظ التعديلات' });
}));

router.delete('/:id', requirePermission('departments:delete'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const dept = db.get('SELECT id FROM departments WHERE id = ?', [id]);
  if (!dept) throw notFound('القسم غير موجود');

  const count = db.get('SELECT COUNT(*) AS n FROM employees WHERE department_id = ?', [id]).n;
  if (count > 0) throw conflict(`لا يمكن حذف القسم لارتباطه بـ ${count} موظف. انقل الموظفين أولاً.`);

  db.run('DELETE FROM departments WHERE id = ?', [id]);
  audit.log(req, 'delete', 'departments', id);
  res.json({ ok: true, message: 'تم حذف القسم' });
}));

module.exports = router;
