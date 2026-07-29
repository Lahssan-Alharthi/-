'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');

const config = require('./config');
const db = require('./db');
const { HttpError } = require('./utils/http');

db.migrate();

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());

// ترويسات أمان أساسية
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
    + "script-src 'self'; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'",
  );
  next();
});

const { router: authRouter } = require('./routes/auth');
const { router: attendanceRouter } = require('./routes/attendance');
const { router: payrollRouter } = require('./routes/payroll');
const misc = require('./routes/misc');

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'madad-employee-portal', time: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/departments', require('./routes/departments'));
app.use('/api/attendance', attendanceRouter);
app.use('/api/leaves', require('./routes/leaves'));
app.use('/api/payroll', payrollRouter);
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/fleet', require('./routes/fleet'));
app.use('/api/trips', require('./routes/trips'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/notifications', misc.notifications);
app.use('/api/audit', misc.audit);
app.use('/api/settings', misc.settings);
app.use('/api/api-keys', require('./routes/apikeys'));

// واجهة الربط للأنظمة الخارجية — توثيق بمفتاح لا بجلسة مستخدم
app.use('/api/v1', require('./routes/v1'));

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'المسار المطلوب غير موجود' });
});

// الواجهة
const publicDir = path.join(config.root, 'public');
app.use(express.static(publicDir, { index: 'index.html', maxAge: config.env === 'production' ? '1h' : 0 }));
app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// معالج الأخطاء المركزي
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? `حجم الملف يتجاوز الحد المسموح (${Math.round(config.maxUploadBytes / 1024 / 1024)} ميجابايت)`
      : 'تعذّر رفع الملف';
    return res.status(400).json({ error: message });
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }

  if (err && err.message && err.message.startsWith('نوع الملف')) {
    return res.status(400).json({ error: err.message });
  }

  // eslint-disable-next-line no-console
  console.error('[خطأ غير متوقع]', err);
  return res.status(500).json({
    error: config.env === 'production' ? 'حدث خطأ داخلي، يرجى المحاولة لاحقاً' : String(err.message || err),
  });
});

if (require.main === module) {
  app.listen(config.port, config.host, () => {
    // eslint-disable-next-line no-console
    console.log(`بوابة موظفي ${config.company.nameAr} تعمل على http://localhost:${config.port}`);
  });
}

module.exports = app;
