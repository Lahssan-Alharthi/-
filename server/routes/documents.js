'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const { asyncHandler, badRequest, notFound, forbidden } = require('../utils/http');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { isPrivileged } = require('../utils/rbac');
const audit = require('../utils/audit');

const router = express.Router();
router.use(requireAuth);

const ALLOWED_MIME = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const CATEGORIES = ['عقود', 'هويات ورخص', 'شهادات', 'تقييمات', 'خطابات', 'سياسات', 'عام'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 10).replace(/[^A-Za-z0-9.]/g, '');
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('نوع الملف غير مسموح به. المسموح: PDF، صور، Word، Excel، نصوص'));
    }
    return cb(null, true);
  },
});

const SELECT_BASE = `
  SELECT d.*, e.full_name_ar AS employee_name, u.full_name_ar AS uploaded_by_name
    FROM documents d
    LEFT JOIN employees e ON e.id = d.employee_id
    LEFT JOIN employees u ON u.id = d.uploaded_by`;

/** هل يحق للمستخدم الوصول إلى هذا المستند؟ */
function canAccess(user, doc) {
  if (doc.visibility === 'public') return true;
  if (doc.employee_id === user.id) return true;
  if (['admin', 'hr'].includes(user.role)) return true;
  return false;
}

router.get('/categories', asyncHandler(async (req, res) => {
  res.json({ data: CATEGORIES });
}));

// قائمة المستندات المتاحة للمستخدم
router.get('/', asyncHandler(async (req, res) => {
  const where = [];
  const params = [];

  if (isPrivileged(req.user.role) && ['admin', 'hr'].includes(req.user.role)) {
    if (req.query.employee_id) { where.push('d.employee_id = ?'); params.push(Number(req.query.employee_id)); }
  } else {
    where.push("(d.employee_id = ? OR d.visibility = 'public')");
    params.push(req.user.id);
  }

  if (req.query.category) { where.push('d.category = ?'); params.push(req.query.category); }
  if (req.query.q) { where.push('d.title LIKE ?'); params.push(`%${req.query.q}%`); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  res.json({ data: db.all(`${SELECT_BASE} ${whereSql} ORDER BY d.created_at DESC LIMIT 300`, params) });
}));

// رفع مستند
router.post('/', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('لم يتم إرفاق أي ملف');

  const title = String(req.body.title || req.file.originalname).trim();
  const visibility = req.body.visibility === 'public' ? 'public' : 'private';

  if (visibility === 'public' && !['admin', 'hr'].includes(req.user.role)) {
    fs.unlinkSync(path.join(config.uploadsDir, req.file.filename));
    throw forbidden('نشر مستند عام يتطلب صلاحية الموارد البشرية');
  }

  let employeeId = req.body.employee_id ? Number(req.body.employee_id) : req.user.id;
  if (employeeId !== req.user.id && !['admin', 'hr'].includes(req.user.role)) {
    fs.unlinkSync(path.join(config.uploadsDir, req.file.filename));
    throw forbidden('لا يمكنك رفع مستندات لموظف آخر');
  }
  if (visibility === 'public') employeeId = null;

  const info = db.run(
    `INSERT INTO documents (employee_id, title, category, file_name, stored_name, mime_type,
                            size_bytes, visibility, expires_at, uploaded_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [employeeId, title, CATEGORIES.includes(req.body.category) ? req.body.category : 'عام',
      req.file.originalname, req.file.filename, req.file.mimetype, req.file.size,
      visibility, req.body.expires_at || null, req.user.id],
  );

  const id = Number(info.lastInsertRowid);
  audit.log(req, 'upload', 'documents', id, { title, size: req.file.size });
  res.status(201).json({ data: db.get(`${SELECT_BASE} WHERE d.id = ?`, [id]), message: 'تم رفع المستند' });
}));

// تنزيل مستند
router.get('/:id/download', asyncHandler(async (req, res) => {
  const doc = db.get('SELECT * FROM documents WHERE id = ?', [Number(req.params.id)]);
  if (!doc) throw notFound('المستند غير موجود');
  if (!canAccess(req.user, doc)) throw forbidden();

  const filePath = path.join(config.uploadsDir, path.basename(doc.stored_name));
  if (!fs.existsSync(filePath)) throw notFound('الملف غير متوفر على الخادم');

  audit.log(req, 'download', 'documents', doc.id);
  res.download(filePath, doc.file_name);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const doc = db.get('SELECT * FROM documents WHERE id = ?', [Number(req.params.id)]);
  if (!doc) throw notFound('المستند غير موجود');

  const owner = doc.uploaded_by === req.user.id || doc.employee_id === req.user.id;
  if (!owner && !['admin', 'hr'].includes(req.user.role)) throw forbidden();

  const filePath = path.join(config.uploadsDir, path.basename(doc.stored_name));
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  db.run('DELETE FROM documents WHERE id = ?', [doc.id]);
  audit.log(req, 'delete', 'documents', doc.id);
  res.json({ ok: true, message: 'تم حذف المستند' });
}));

// المستندات المنتهية أو التي تقارب الانتهاء
router.get('/alerts/expiring', requirePermission('documents:read'), asyncHandler(async (req, res) => {
  const days = Math.min(365, Number(req.query.days) || 30);
  res.json({
    data: db.all(
      `${SELECT_BASE}
        WHERE d.expires_at IS NOT NULL AND d.expires_at <= date('now', '+' || ? || ' days')
        ORDER BY d.expires_at`,
      [days],
    ),
  });
}));

module.exports = router;
