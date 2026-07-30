'use strict';

const express = require('express');
const db = require('../db');
const { asyncHandler, badRequest, notFound, forbidden, conflict } = require('../utils/http');
const { requireAuth, requirePermission } = require('../middleware/auth');
const audit = require('../utils/audit');
const notify = require('../utils/notify');
const hooks = require('../utils/webhooks');

const router = express.Router();
router.use(requireAuth);

const STATUSES = ['planned', 'in_progress', 'completed', 'cancelled', 'delayed'];

const SELECT_BASE = `
  SELECT t.*, v.plate_no, v.type AS vehicle_type,
         e.full_name_ar AS driver_name, e.phone AS driver_phone,
         c.full_name_ar AS created_by_name
    FROM trips t
    LEFT JOIN vehicles  v ON v.id = t.vehicle_id
    LEFT JOIN employees e ON e.id = t.driver_id
    LEFT JOIN employees c ON c.id = t.created_by`;

/** يولّد رمز رحلة متسلسل بصيغة TRP-YYYY-0001. */
function nextTripCode() {
  const year = new Date().getFullYear();
  const row = db.get(
    "SELECT COUNT(*) AS n FROM trips WHERE code LIKE ?",
    [`TRP-${year}-%`],
  );
  return `TRP-${year}-${String(row.n + 1).padStart(4, '0')}`;
}

router.get('/meta', asyncHandler(async (req, res) => {
  res.json({ data: { statuses: STATUSES } });
}));

// قائمة الرحلات — السائق يرى رحلاته فقط
router.get('/', asyncHandler(async (req, res) => {
  const where = [];
  const params = [];

  const privileged = ['admin', 'operations', 'manager', 'hr', 'finance'].includes(req.user.role);
  if (!privileged || req.query.scope === 'mine') {
    where.push('t.driver_id = ?');
    params.push(req.user.id);
  }

  if (req.query.status) { where.push('t.status = ?'); params.push(req.query.status); }
  if (req.query.vehicle_id) { where.push('t.vehicle_id = ?'); params.push(Number(req.query.vehicle_id)); }
  if (req.query.driver_id && privileged) { where.push('t.driver_id = ?'); params.push(Number(req.query.driver_id)); }
  if (req.query.from) { where.push('date(t.depart_at) >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('date(t.depart_at) <= ?'); params.push(req.query.to); }
  if (req.query.q) {
    where.push('(t.code LIKE ? OR t.origin LIKE ? OR t.destination LIKE ? OR t.client_name LIKE ?)');
    const like = `%${req.query.q}%`;
    params.push(like, like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));

  res.json({ data: db.all(`${SELECT_BASE} ${whereSql} ORDER BY t.depart_at DESC LIMIT ?`, [...params, limit]) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const row = db.get(`${SELECT_BASE} WHERE t.id = ?`, [Number(req.params.id)]);
  if (!row) throw notFound('الرحلة غير موجودة');

  const privileged = ['admin', 'operations', 'manager', 'hr', 'finance'].includes(req.user.role);
  if (!privileged && row.driver_id !== req.user.id) throw forbidden();

  res.json({ data: row });
}));

router.post('/', requirePermission('trips:create'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!String(body.origin || '').trim() || !String(body.destination || '').trim()) {
    throw badRequest('نقطة الانطلاق والوجهة حقلان إلزاميان');
  }

  const vehicleId = body.vehicle_id ? Number(body.vehicle_id) : null;
  const driverId = body.driver_id ? Number(body.driver_id) : null;

  if (vehicleId) {
    const vehicle = db.get('SELECT * FROM vehicles WHERE id = ?', [vehicleId]);
    if (!vehicle) throw notFound('المركبة غير موجودة');
    if (['maintenance', 'out_of_service'].includes(vehicle.status)) {
      throw conflict(`المركبة ${vehicle.plate_no} غير متاحة حالياً`);
    }
  }

  const code = String(body.code || '').trim() || nextTripCode();
  if (db.get('SELECT id FROM trips WHERE code = ?', [code])) throw conflict('رمز الرحلة مستخدم مسبقاً');

  const info = db.run(
    `INSERT INTO trips (code, vehicle_id, driver_id, client_name, origin, destination, cargo,
                        weight_kg, distance_km, cost, depart_at, arrive_at, status, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [code, vehicleId, driverId, body.client_name || null,
      String(body.origin).trim(), String(body.destination).trim(), body.cargo || null,
      body.weight_kg ? Number(body.weight_kg) : null,
      body.distance_km ? Number(body.distance_km) : null,
      body.cost ? Number(body.cost) : null,
      body.depart_at || null, body.arrive_at || null,
      STATUSES.includes(body.status) ? body.status : 'planned',
      body.notes || null, req.user.id],
  );

  const id = Number(info.lastInsertRowid);
  if (driverId) {
    notify.push(driverId, 'تم إسناد رحلة جديدة',
      `${code}: من ${body.origin} إلى ${body.destination}`, '#/trips');
  }

  audit.log(req, 'create', 'trips', id, { code });
  hooks.emit('trip.created', {
    code, origin: body.origin, destination: body.destination,
    client_name: body.client_name || null, status: 'planned',
  });
  res.status(201).json({ data: db.get(`${SELECT_BASE} WHERE t.id = ?`, [id]), message: `تم إنشاء الرحلة ${code}` });
}));

router.put('/:id', requirePermission('trips:update'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = db.get('SELECT * FROM trips WHERE id = ?', [id]);
  if (!existing) throw notFound('الرحلة غير موجودة');

  const fields = ['vehicle_id', 'driver_id', 'client_name', 'origin', 'destination', 'cargo',
    'weight_kg', 'distance_km', 'cost', 'depart_at', 'arrive_at', 'status', 'notes'];
  const updates = [];
  const params = [];

  fields.forEach((field) => {
    if (!(field in req.body)) return;
    let value = req.body[field];
    if (['vehicle_id', 'driver_id', 'weight_kg', 'distance_km', 'cost'].includes(field)) {
      value = value === '' || value === null ? null : Number(value);
    }
    if (field === 'status' && !STATUSES.includes(value)) throw badRequest('حالة الرحلة غير صالحة');
    updates.push(`${field} = ?`);
    params.push(value === '' ? null : value);
  });

  if (!updates.length) throw badRequest('لا توجد حقول للتعديل');

  db.run(`UPDATE trips SET ${updates.join(', ')} WHERE id = ?`, [...params, id]);

  if (req.body.driver_id && Number(req.body.driver_id) !== existing.driver_id) {
    notify.push(Number(req.body.driver_id), 'تم إسناد رحلة إليك', existing.code, '#/trips');
  }

  audit.log(req, 'update', 'trips', id);
  res.json({ data: db.get(`${SELECT_BASE} WHERE t.id = ?`, [id]), message: 'تم حفظ التعديلات' });
}));

/**
 * تحديث حالة الرحلة. السائق يستطيع تحديث حالة رحلته فقط،
 * وتُحدَّث حالة المركبة تبعاً لذلك.
 */
router.post('/:id/status', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body.status;
  if (!STATUSES.includes(status)) throw badRequest('حالة الرحلة غير صالحة');

  const trip = db.get('SELECT * FROM trips WHERE id = ?', [id]);
  if (!trip) throw notFound('الرحلة غير موجودة');

  const privileged = ['admin', 'operations', 'manager'].includes(req.user.role);
  if (!privileged && trip.driver_id !== req.user.id) throw forbidden('يمكنك تحديث رحلاتك فقط');

  db.transaction(() => {
    db.run(
      `UPDATE trips SET status = ?, notes = COALESCE(?, notes),
              arrive_at = CASE WHEN ? = 'completed' AND arrive_at IS NULL
                               THEN datetime('now') ELSE arrive_at END
        WHERE id = ?`,
      [status, req.body.notes || null, status, id],
    );

    if (trip.vehicle_id) {
      const vehicleStatus = status === 'in_progress' ? 'on_trip'
        : (['completed', 'cancelled'].includes(status) ? 'available' : null);
      if (vehicleStatus) {
        db.run("UPDATE vehicles SET status = ? WHERE id = ? AND status <> 'maintenance'",
          [vehicleStatus, trip.vehicle_id]);
      }
      if (status === 'completed' && trip.distance_km) {
        db.run('UPDATE vehicles SET odometer_km = odometer_km + ? WHERE id = ?',
          [trip.distance_km, trip.vehicle_id]);
      }
    }
  });

  audit.log(req, 'status_change', 'trips', id, { status });
  hooks.emit('trip.status_changed', {
    code: trip.code, previous_status: trip.status, status,
    origin: trip.origin, destination: trip.destination,
  });
  res.json({ data: db.get(`${SELECT_BASE} WHERE t.id = ?`, [id]), message: 'تم تحديث حالة الرحلة' });
}));

router.delete('/:id', requirePermission('trips:delete'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const trip = db.get('SELECT * FROM trips WHERE id = ?', [id]);
  if (!trip) throw notFound('الرحلة غير موجودة');
  if (trip.status === 'in_progress') throw conflict('لا يمكن حذف رحلة جارية');

  db.run('DELETE FROM trips WHERE id = ?', [id]);
  audit.log(req, 'delete', 'trips', id);
  res.json({ ok: true, message: 'تم حذف الرحلة' });
}));

module.exports = router;
