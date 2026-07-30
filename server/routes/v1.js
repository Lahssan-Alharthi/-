'use strict';

/**
 * واجهة الربط الإصدار الأول — مخصّصة للأنظمة الخارجية (ERP، أجهزة البصمة،
 * أنظمة تتبّع المركبات، تطبيقات الجوال). التوثيق بمفتاح ربط لا بجلسة مستخدم،
 * وكل مسار يتطلّب نطاق وصول صريحاً.
 */

const express = require('express');
const db = require('../db');
const { asyncHandler, badRequest, notFound, conflict } = require('../utils/http');
const { requireApiKey, requireScope, logApiWrite } = require('../middleware/apiauth');
const { computeMetrics } = require('./attendance');
const dates = require('../utils/dates');
const hooks = require('../utils/webhooks');

const router = express.Router();
router.use(requireApiKey);

const MAX_PAGE_SIZE = 200;

/** يقرأ معطيات الترقيم من الاستعلام. */
function paging(req) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.limit) || 50));
  return { page, limit, offset: (page - 1) * limit };
}

function envelope(rows, total, page, limit) {
  return {
    data: rows,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
  };
}

// ------------------------------------------------------------------ الحالة

router.get('/ping', asyncHandler(async (req, res) => {
  res.json({
    ok: true,
    api_version: 'v1',
    key_name: req.apiKey.name,
    environment: req.apiKey.environment,
    scopes: req.apiKey.scopes,
    server_time: new Date().toISOString(),
  });
}));

// --------------------------------------------------------------- الموظفون

const EMPLOYEE_PUBLIC = `
  e.employee_no, e.full_name_ar, e.full_name_en, e.email, e.phone, e.job_title,
  e.status, e.hire_date, e.contract_type, e.nationality, e.gender,
  d.code AS department_code, d.name_ar AS department_name,
  m.employee_no AS manager_employee_no`;

const EMPLOYEE_FINANCIAL = `
  e.basic_salary, e.housing_allowance, e.transport_allowance, e.other_allowance,
  e.bank_name, e.iban`;

/** الحقول المالية تُضاف فقط إذا كان المفتاح يملك نطاق payroll:read. */
function employeeSelect(req) {
  const financial = req.apiKey.scopes.includes('payroll:read') ? `, ${EMPLOYEE_FINANCIAL}` : '';
  return `SELECT ${EMPLOYEE_PUBLIC}${financial}
            FROM employees e
            LEFT JOIN departments d ON d.id = e.department_id
            LEFT JOIN employees   m ON m.id = e.manager_id`;
}

router.get('/employees', requireScope('employees:read'), asyncHandler(async (req, res) => {
  const { page, limit, offset } = paging(req);
  const where = [];
  const params = [];

  if (req.query.status) { where.push('e.status = ?'); params.push(req.query.status); }
  if (req.query.department_code) { where.push('d.code = ?'); params.push(req.query.department_code); }
  if (req.query.updated_since) {
    where.push('e.updated_at >= ?');
    params.push(String(req.query.updated_since));
  }
  if (req.query.q) {
    where.push('(e.full_name_ar LIKE ? OR e.employee_no LIKE ? OR e.email LIKE ?)');
    const like = `%${req.query.q}%`;
    params.push(like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.get(
    `SELECT COUNT(*) AS n FROM employees e LEFT JOIN departments d ON d.id = e.department_id ${whereSql}`,
    params,
  ).n;

  const rows = db.all(
    `${employeeSelect(req)} ${whereSql} ORDER BY e.employee_no LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  res.json(envelope(rows, total, page, limit));
}));

// يُستخدم الرقم الوظيفي كمعرّف خارجي لأنه ثابت في أنظمة الشركة
router.get('/employees/:employeeNo', requireScope('employees:read'), asyncHandler(async (req, res) => {
  const row = db.get(`${employeeSelect(req)} WHERE e.employee_no = ?`, [req.params.employeeNo]);
  if (!row) throw notFound('الموظف غير موجود');
  res.json({ data: row });
}));

// ---------------------------------------------------------------- الأقسام

router.get('/departments', requireScope('departments:read'), asyncHandler(async (req, res) => {
  const rows = db.all(
    `SELECT d.code, d.name_ar, d.name_en, d.cost_center,
            m.employee_no AS manager_employee_no,
            (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.id AND e.status = 'active') AS employees_count
       FROM departments d LEFT JOIN employees m ON m.id = d.manager_id
      ORDER BY d.code`,
  );
  res.json({ data: rows });
}));

// ----------------------------------------------------------------- الحضور

router.get('/attendance', requireScope('attendance:read'), asyncHandler(async (req, res) => {
  const { page, limit, offset } = paging(req);
  const where = [];
  const params = [];

  if (req.query.employee_no) { where.push('e.employee_no = ?'); params.push(req.query.employee_no); }
  if (req.query.from) { where.push('a.date >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('a.date <= ?'); params.push(req.query.to); }
  if (req.query.status) { where.push('a.status = ?'); params.push(req.query.status); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.get(
    `SELECT COUNT(*) AS n FROM attendance a JOIN employees e ON e.id = a.employee_id ${whereSql}`,
    params,
  ).n;

  const rows = db.all(
    `SELECT e.employee_no, e.full_name_ar AS employee_name, a.date, a.check_in, a.check_out,
            a.status, a.work_minutes, a.late_minutes, a.overtime_minutes, a.source
       FROM attendance a JOIN employees e ON e.id = a.employee_id
       ${whereSql} ORDER BY a.date DESC, e.employee_no LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  res.json(envelope(rows, total, page, limit));
}));

/**
 * دفع سجلات حضور من جهاز بصمة أو نظام خارجي.
 * يقبل حتى 500 سجل في الطلب، ويعيد نتيجة كل سجل على حدة
 * حتى لا يفشل الدفعة كلها بسبب سجل واحد.
 */
router.post('/attendance', requireScope('attendance:write'), asyncHandler(async (req, res) => {
  const records = Array.isArray(req.body.records) ? req.body.records
    : (Array.isArray(req.body) ? req.body : null);

  if (!records) throw badRequest('يجب إرسال records كمصفوفة سجلات');
  if (!records.length) throw badRequest('لا توجد سجلات في الطلب');
  if (records.length > 500) throw badRequest('الحد الأقصى 500 سجل في الطلب الواحد');

  const results = [];
  let accepted = 0;

  records.forEach((record, index) => {
    const employeeNo = String(record.employee_no || '').trim();
    const date = String(record.date || '').trim();

    const fail = (error) => results.push({ index, employee_no: employeeNo, date, ok: false, error });

    if (!employeeNo || !dates.isValidDate(date)) {
      fail('employee_no و date مطلوبان، والتاريخ بصيغة YYYY-MM-DD');
      return;
    }

    const employee = db.get('SELECT id FROM employees WHERE employee_no = ?', [employeeNo]);
    if (!employee) { fail('الموظف غير موجود'); return; }

    const checkIn = record.check_in ? String(record.check_in).slice(0, 5) : null;
    const checkOut = record.check_out ? String(record.check_out).slice(0, 5) : null;
    if (checkIn && dates.toMinutes(checkIn) === null) { fail('صيغة check_in غير صحيحة'); return; }
    if (checkOut && dates.toMinutes(checkOut) === null) { fail('صيغة check_out غير صحيحة'); return; }

    const metrics = computeMetrics(checkIn, checkOut);
    const status = ['present', 'late', 'absent', 'leave', 'remote', 'mission', 'holiday']
      .includes(record.status) ? record.status : metrics.status;
    const zeroed = ['absent', 'leave', 'holiday'].includes(status);

    db.run(
      `INSERT INTO attendance (employee_id, date, check_in, check_out, status, work_minutes,
              late_minutes, overtime_minutes, early_leave_minutes, source, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(employee_id, date) DO UPDATE SET
          check_in = COALESCE(excluded.check_in, attendance.check_in),
          check_out = COALESCE(excluded.check_out, attendance.check_out),
          status = excluded.status,
          work_minutes = excluded.work_minutes,
          late_minutes = excluded.late_minutes,
          overtime_minutes = excluded.overtime_minutes,
          early_leave_minutes = excluded.early_leave_minutes,
          source = excluded.source,
          notes = COALESCE(excluded.notes, attendance.notes)`,
      [employee.id, date, checkIn, checkOut, status,
        zeroed ? 0 : metrics.work_minutes,
        zeroed ? 0 : metrics.late_minutes,
        zeroed ? 0 : metrics.overtime_minutes,
        zeroed ? 0 : metrics.early_leave_minutes,
        String(record.source || 'device').slice(0, 40), record.notes || null],
    );

    accepted += 1;
    results.push({ index, employee_no: employeeNo, date, ok: true, status });
  });

  logApiWrite(req, 'attendance_push', 'attendance', null,
    { received: records.length, accepted, rejected: records.length - accepted });

  if (accepted) {
    hooks.emit('attendance.recorded', {
      source: 'api', api_key: req.apiKey.name, accepted,
      records: results.filter((r) => r.ok).map((r) => ({ employee_no: r.employee_no, date: r.date })),
    });
  }

  res.status(accepted === records.length ? 201 : 207).json({
    received: records.length,
    accepted,
    rejected: records.length - accepted,
    results,
  });
}));

// --------------------------------------------------------------- الإجازات

router.get('/leaves', requireScope('leaves:read'), asyncHandler(async (req, res) => {
  const { page, limit, offset } = paging(req);
  const where = [];
  const params = [];

  if (req.query.employee_no) { where.push('e.employee_no = ?'); params.push(req.query.employee_no); }
  if (req.query.status) { where.push('l.status = ?'); params.push(req.query.status); }
  if (req.query.from) { where.push('l.end_date >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('l.start_date <= ?'); params.push(req.query.to); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.get(
    `SELECT COUNT(*) AS n FROM leaves l JOIN employees e ON e.id = l.employee_id ${whereSql}`,
    params,
  ).n;

  const rows = db.all(
    `SELECT e.employee_no, e.full_name_ar AS employee_name, t.code AS leave_type,
            t.name_ar AS leave_type_name, l.start_date, l.end_date, l.days, l.status,
            l.reason, l.decided_at
       FROM leaves l
       JOIN employees   e ON e.id = l.employee_id
       JOIN leave_types t ON t.id = l.leave_type_id
       ${whereSql} ORDER BY l.start_date DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  res.json(envelope(rows, total, page, limit));
}));

// ---------------------------------------------------------------- الرواتب

router.get('/payroll/runs', requireScope('payroll:read'), asyncHandler(async (req, res) => {
  const rows = db.all(
    `SELECT id, year, month, status, total_gross, total_net, total_gosi_employer,
            approved_at, created_at
       FROM payroll_runs ORDER BY year DESC, month DESC`,
  );
  res.json({ data: rows });
}));

router.get('/payroll/runs/:id/payslips', requireScope('payroll:read'), asyncHandler(async (req, res) => {
  const run = db.get('SELECT * FROM payroll_runs WHERE id = ?', [Number(req.params.id)]);
  if (!run) throw notFound('المسيّر غير موجود');

  const rows = db.all(
    `SELECT e.employee_no, e.full_name_ar AS employee_name, e.iban, e.bank_name,
            p.basic_salary, p.housing_allowance, p.transport_allowance, p.other_allowance,
            p.overtime_amount, p.gosi_deduction, p.gosi_employer, p.gosi_total, p.gosi_category,
            p.absence_deduction, p.loan_deduction, p.other_deduction,
            p.gross_amount, p.net_amount
       FROM payslips p JOIN employees e ON e.id = p.employee_id
      WHERE p.run_id = ? ORDER BY e.employee_no`,
    [run.id],
  );

  res.json({ data: { run: { id: run.id, year: run.year, month: run.month, status: run.status }, payslips: rows } });
}));

// ---------------------------------------------------------------- الأسطول

router.get('/fleet', requireScope('fleet:read'), asyncHandler(async (req, res) => {
  const rows = db.all(
    `SELECT v.plate_no, v.type, v.make_model, v.year, v.capacity_kg, v.status,
            v.odometer_km, v.last_maintenance, v.next_maintenance,
            v.insurance_expiry, v.registration_expiry,
            e.employee_no AS driver_employee_no, e.full_name_ar AS driver_name
       FROM vehicles v LEFT JOIN employees e ON e.id = v.driver_id
      ORDER BY v.plate_no`,
  );
  res.json({ data: rows });
}));

/** تحديث حالة مركبة أو قراءة عدّادها من نظام تتبّع خارجي. */
router.patch('/fleet/:plate', requireScope('fleet:write'), asyncHandler(async (req, res) => {
  const vehicle = db.get('SELECT * FROM vehicles WHERE plate_no = ?', [req.params.plate]);
  if (!vehicle) throw notFound('المركبة غير موجودة');

  const updates = [];
  const params = [];

  if (req.body.odometer_km !== undefined) {
    const odometer = Number(req.body.odometer_km);
    if (!Number.isFinite(odometer) || odometer < 0) throw badRequest('قراءة العدّاد غير صالحة');
    if (odometer < vehicle.odometer_km) throw badRequest('قراءة العدّاد أقل من القراءة المسجّلة');
    updates.push('odometer_km = ?');
    params.push(odometer);
  }

  if (req.body.status !== undefined) {
    if (!['available', 'on_trip', 'maintenance', 'out_of_service'].includes(req.body.status)) {
      throw badRequest('حالة المركبة غير صالحة');
    }
    updates.push('status = ?');
    params.push(req.body.status);
  }

  if (!updates.length) throw badRequest('لا توجد حقول للتحديث (odometer_km أو status)');

  db.run(`UPDATE vehicles SET ${updates.join(', ')} WHERE id = ?`, [...params, vehicle.id]);
  logApiWrite(req, 'fleet_update', 'vehicles', vehicle.id, { plate_no: vehicle.plate_no });

  res.json({ data: db.get('SELECT plate_no, status, odometer_km FROM vehicles WHERE id = ?', [vehicle.id]) });
}));

// ---------------------------------------------------------------- الرحلات

router.get('/trips', requireScope('trips:read'), asyncHandler(async (req, res) => {
  const { page, limit, offset } = paging(req);
  const where = [];
  const params = [];

  if (req.query.status) { where.push('t.status = ?'); params.push(req.query.status); }
  if (req.query.driver_employee_no) { where.push('e.employee_no = ?'); params.push(req.query.driver_employee_no); }
  if (req.query.plate_no) { where.push('v.plate_no = ?'); params.push(req.query.plate_no); }
  if (req.query.from) { where.push('date(COALESCE(t.depart_at, t.created_at)) >= ?'); params.push(req.query.from); }
  if (req.query.to) { where.push('date(COALESCE(t.depart_at, t.created_at)) <= ?'); params.push(req.query.to); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.get(
    `SELECT COUNT(*) AS n FROM trips t
       LEFT JOIN vehicles v ON v.id = t.vehicle_id
       LEFT JOIN employees e ON e.id = t.driver_id ${whereSql}`,
    params,
  ).n;

  const rows = db.all(
    `SELECT t.code, t.client_name, t.origin, t.destination, t.cargo, t.weight_kg,
            t.distance_km, t.cost, t.depart_at, t.arrive_at, t.status, t.notes,
            v.plate_no, e.employee_no AS driver_employee_no, e.full_name_ar AS driver_name
       FROM trips t
       LEFT JOIN vehicles  v ON v.id = t.vehicle_id
       LEFT JOIN employees e ON e.id = t.driver_id
       ${whereSql} ORDER BY t.depart_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  res.json(envelope(rows, total, page, limit));
}));

router.get('/trips/:code', requireScope('trips:read'), asyncHandler(async (req, res) => {
  const row = db.get(
    `SELECT t.code, t.client_name, t.origin, t.destination, t.cargo, t.weight_kg,
            t.distance_km, t.cost, t.depart_at, t.arrive_at, t.status, t.notes,
            v.plate_no, e.employee_no AS driver_employee_no, e.full_name_ar AS driver_name
       FROM trips t
       LEFT JOIN vehicles  v ON v.id = t.vehicle_id
       LEFT JOIN employees e ON e.id = t.driver_id
      WHERE t.code = ?`,
    [req.params.code],
  );
  if (!row) throw notFound('الرحلة غير موجودة');
  res.json({ data: row });
}));

/** إنشاء رحلة من نظام إدارة النقل أو من منصّة العميل. */
router.post('/trips', requireScope('trips:write'), asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!String(body.origin || '').trim() || !String(body.destination || '').trim()) {
    throw badRequest('origin و destination حقلان إلزاميان');
  }

  let vehicleId = null;
  if (body.plate_no) {
    const vehicle = db.get('SELECT id, status FROM vehicles WHERE plate_no = ?', [body.plate_no]);
    if (!vehicle) throw notFound(`المركبة ${body.plate_no} غير موجودة`);
    if (['maintenance', 'out_of_service'].includes(vehicle.status)) {
      throw conflict(`المركبة ${body.plate_no} غير متاحة حالياً`);
    }
    vehicleId = vehicle.id;
  }

  let driverId = null;
  if (body.driver_employee_no) {
    const driver = db.get('SELECT id FROM employees WHERE employee_no = ?', [body.driver_employee_no]);
    if (!driver) throw notFound(`الموظف ${body.driver_employee_no} غير موجود`);
    driverId = driver.id;
  }

  const year = new Date().getFullYear();
  const code = String(body.code || '').trim()
    || `TRP-${year}-${String(db.get('SELECT COUNT(*) AS n FROM trips WHERE code LIKE ?', [`TRP-${year}-%`]).n + 1).padStart(4, '0')}`;

  if (db.get('SELECT id FROM trips WHERE code = ?', [code])) throw conflict('رمز الرحلة مستخدم مسبقاً');

  const info = db.run(
    `INSERT INTO trips (code, vehicle_id, driver_id, client_name, origin, destination, cargo,
            weight_kg, distance_km, cost, depart_at, arrive_at, status, notes)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [code, vehicleId, driverId, body.client_name || null,
      String(body.origin).trim(), String(body.destination).trim(), body.cargo || null,
      body.weight_kg ? Number(body.weight_kg) : null,
      body.distance_km ? Number(body.distance_km) : null,
      body.cost ? Number(body.cost) : null,
      body.depart_at || null, body.arrive_at || null,
      ['planned', 'in_progress', 'completed', 'cancelled', 'delayed'].includes(body.status)
        ? body.status : 'planned',
      body.notes || null],
  );

  logApiWrite(req, 'trip_create', 'trips', Number(info.lastInsertRowid), { code });
  res.status(201).json({ data: db.get('SELECT code, origin, destination, status FROM trips WHERE code = ?', [code]) });
}));

/** تحديث حالة رحلة من تطبيق السائق أو نظام التتبّع. */
router.patch('/trips/:code/status', requireScope('trips:write'), asyncHandler(async (req, res) => {
  const status = req.body.status;
  if (!['planned', 'in_progress', 'completed', 'cancelled', 'delayed'].includes(status)) {
    throw badRequest('حالة الرحلة غير صالحة');
  }

  const trip = db.get('SELECT * FROM trips WHERE code = ?', [req.params.code]);
  if (!trip) throw notFound('الرحلة غير موجودة');

  db.transaction(() => {
    db.run(
      `UPDATE trips SET status = ?, notes = COALESCE(?, notes),
              arrive_at = CASE WHEN ? = 'completed' AND arrive_at IS NULL
                               THEN datetime('now') ELSE arrive_at END
        WHERE id = ?`,
      [status, req.body.notes || null, status, trip.id],
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

  logApiWrite(req, 'trip_status', 'trips', trip.id, { code: trip.code, status });
  res.json({ data: db.get('SELECT code, status, arrive_at FROM trips WHERE id = ?', [trip.id]) });
}));

module.exports = router;
