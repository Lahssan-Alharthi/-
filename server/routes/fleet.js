'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler, badRequest, notFound, conflict } = require('../utils/http');
const { requireAuth, requirePermission } = require('../middleware/auth');
const audit = require('../utils/audit');
const hooks = require('../utils/webhooks');
const notify = require('../utils/notify');

const router = express.Router();
router.use(requireAuth);

const STATUSES = ['available', 'on_trip', 'maintenance', 'out_of_service'];
const TYPES = ['شاحنة', 'تريلا', 'دينا', 'فان', 'سيارة نقل خفيف', 'رافعة شوكية'];

const SELECT_BASE = `
  SELECT v.*, e.full_name_ar AS driver_name, e.phone AS driver_phone,
         (SELECT COUNT(*) FROM trips t WHERE t.vehicle_id = v.id AND t.status = 'in_progress') AS active_trips
    FROM vehicles v
    LEFT JOIN employees e ON e.id = v.driver_id`;

router.get('/meta', asyncHandler(async (req, res) => {
  res.json({ data: { statuses: STATUSES, types: TYPES } });
}));

router.get('/', requirePermission('fleet:read'), asyncHandler(async (req, res) => {
  const where = [];
  const params = [];

  if (req.query.status) { where.push('v.status = ?'); params.push(req.query.status); }
  if (req.query.type) { where.push('v.type = ?'); params.push(req.query.type); }
  if (req.query.q) {
    where.push('(v.plate_no LIKE ? OR v.make_model LIKE ?)');
    params.push(`%${req.query.q}%`, `%${req.query.q}%`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  res.json({ data: db.all(`${SELECT_BASE} ${whereSql} ORDER BY v.plate_no`, params) });
}));

router.get('/:id', requirePermission('fleet:read'), asyncHandler(async (req, res) => {
  const row = db.get(`${SELECT_BASE} WHERE v.id = ?`, [Number(req.params.id)]);
  if (!row) throw notFound('المركبة غير موجودة');

  row.recent_trips = db.all(
    `SELECT t.id, t.code, t.origin, t.destination, t.status, t.depart_at, e.full_name_ar AS driver_name
       FROM trips t LEFT JOIN employees e ON e.id = t.driver_id
      WHERE t.vehicle_id = ? ORDER BY t.created_at DESC LIMIT 10`,
    [row.id],
  );
  res.json({ data: row });
}));

router.post('/', requirePermission('fleet:create'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  const plate = String(body.plate_no || '').trim();
  if (!plate) throw badRequest('رقم اللوحة إلزامي');
  if (db.get('SELECT id FROM vehicles WHERE plate_no = ?', [plate])) {
    throw conflict('رقم اللوحة مسجّل مسبقاً');
  }

  const info = db.run(
    `INSERT INTO vehicles (plate_no, type, make_model, year, capacity_kg, status, driver_id,
                           odometer_km, last_maintenance, next_maintenance, insurance_expiry,
                           registration_expiry, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [plate, TYPES.includes(body.type) ? body.type : 'شاحنة', body.make_model || null,
      body.year ? Number(body.year) : null, body.capacity_kg ? Number(body.capacity_kg) : null,
      STATUSES.includes(body.status) ? body.status : 'available',
      body.driver_id ? Number(body.driver_id) : null, Number(body.odometer_km) || 0,
      body.last_maintenance || null, body.next_maintenance || null,
      body.insurance_expiry || null, body.registration_expiry || null, body.notes || null],
  );

  const id = Number(info.lastInsertRowid);
  audit.log(req, 'create', 'vehicles', id, { plate });
  res.status(201).json({ data: db.get(`${SELECT_BASE} WHERE v.id = ?`, [id]), message: 'تمت إضافة المركبة' });
}));

router.put('/:id', requirePermission('fleet:update'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!db.get('SELECT id FROM vehicles WHERE id = ?', [id])) throw notFound('المركبة غير موجودة');

  const fields = ['plate_no', 'type', 'make_model', 'year', 'capacity_kg', 'status', 'driver_id',
    'odometer_km', 'last_maintenance', 'next_maintenance', 'insurance_expiry',
    'registration_expiry', 'notes'];
  const updates = [];
  const params = [];

  fields.forEach((field) => {
    if (!(field in req.body)) return;
    let value = req.body[field];
    if (['year', 'capacity_kg', 'odometer_km', 'driver_id'].includes(field)) {
      value = value === '' || value === null ? null : Number(value);
    }
    if (field === 'status' && !STATUSES.includes(value)) throw badRequest('حالة المركبة غير صالحة');
    if (field === 'plate_no') {
      const clash = db.get('SELECT id FROM vehicles WHERE plate_no = ? AND id <> ?', [value, id]);
      if (clash) throw conflict('رقم اللوحة مسجّل لمركبة أخرى');
    }
    updates.push(`${field} = ?`);
    params.push(value === '' ? null : value);
  });

  if (!updates.length) throw badRequest('لا توجد حقول للتعديل');

  db.run(`UPDATE vehicles SET ${updates.join(', ')} WHERE id = ?`, [...params, id]);
  audit.log(req, 'update', 'vehicles', id);
  res.json({ data: db.get(`${SELECT_BASE} WHERE v.id = ?`, [id]), message: 'تم حفظ التعديلات' });
}));

router.delete('/:id', requirePermission('fleet:delete'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!db.get('SELECT id FROM vehicles WHERE id = ?', [id])) throw notFound('المركبة غير موجودة');

  const active = db.get(
    "SELECT COUNT(*) AS n FROM trips WHERE vehicle_id = ? AND status IN ('planned','in_progress')",
    [id],
  ).n;
  if (active > 0) throw conflict('لا يمكن حذف مركبة مرتبطة برحلات نشطة');

  db.run('DELETE FROM vehicles WHERE id = ?', [id]);
  audit.log(req, 'delete', 'vehicles', id);
  res.json({ ok: true, message: 'تم حذف المركبة' });
}));

// تنبيهات انتهاء الوثائق والصيانة
router.get('/alerts/due', requirePermission('fleet:read'), asyncHandler(async (req, res) => {
  const days = Math.min(180, Number(req.query.days) || 30);
  const rows = db.all(
    `SELECT v.id, v.plate_no, v.type, v.insurance_expiry, v.registration_expiry, v.next_maintenance
       FROM vehicles v
      WHERE (v.insurance_expiry    IS NOT NULL AND v.insurance_expiry    <= date('now', '+' || ? || ' days'))
         OR (v.registration_expiry IS NOT NULL AND v.registration_expiry <= date('now', '+' || ? || ' days'))
         OR (v.next_maintenance    IS NOT NULL AND v.next_maintenance    <= date('now', '+' || ? || ' days'))
      ORDER BY v.plate_no`,
    [days, days, days],
  );
  res.json({ data: rows });
}));

// تسجيل صيانة
router.post('/:id/maintenance', requirePermission('fleet:update'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const vehicle = db.get('SELECT * FROM vehicles WHERE id = ?', [id]);
  if (!vehicle) throw notFound('المركبة غير موجودة');

  db.run(
    `UPDATE vehicles
        SET last_maintenance = ?, next_maintenance = ?, odometer_km = ?, status = ?, notes = ?
      WHERE id = ?`,
    [req.body.date || new Date().toISOString().slice(0, 10),
      req.body.next_maintenance || null,
      req.body.odometer_km !== undefined ? Number(req.body.odometer_km) : vehicle.odometer_km,
      req.body.status && STATUSES.includes(req.body.status) ? req.body.status : vehicle.status,
      req.body.notes || vehicle.notes, id],
  );

  if (vehicle.driver_id) {
    notify.push(vehicle.driver_id, 'تحديث حالة المركبة',
      `تم تسجيل صيانة للمركبة ${vehicle.plate_no}`, '#/fleet');
  }

  audit.log(req, 'maintenance', 'vehicles', id);
  hooks.emit('vehicle.maintenance', {
    plate_no: vehicle.plate_no, type: vehicle.type,
    date: req.body.date || new Date().toISOString().slice(0, 10),
    next_maintenance: req.body.next_maintenance || null,
  });
  res.json({ data: db.get(`${SELECT_BASE} WHERE v.id = ?`, [id]), message: 'تم تسجيل الصيانة' });
}));

module.exports = router;
