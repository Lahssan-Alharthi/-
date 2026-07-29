-- =====================================================================
--  بوابة موظفي شركة مدد للخدمات اللوجستية - مخطط قاعدة البيانات
-- =====================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS departments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT    NOT NULL UNIQUE,
  name_ar      TEXT    NOT NULL,
  name_en      TEXT,
  description  TEXT,
  manager_id   INTEGER,
  cost_center  TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS employees (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_no           TEXT    NOT NULL UNIQUE,
  national_id           TEXT    UNIQUE,
  full_name_ar          TEXT    NOT NULL,
  full_name_en          TEXT,
  email                 TEXT    NOT NULL UNIQUE,
  phone                 TEXT,
  password_hash         TEXT    NOT NULL,
  must_change_password  INTEGER NOT NULL DEFAULT 0,
  role                  TEXT    NOT NULL DEFAULT 'employee',
  job_title             TEXT,
  department_id         INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  manager_id            INTEGER REFERENCES employees(id)   ON DELETE SET NULL,
  hire_date             TEXT,
  contract_type         TEXT    DEFAULT 'دوام كامل',
  status                TEXT    NOT NULL DEFAULT 'active',
  nationality           TEXT,
  gender                TEXT,
  birth_date            TEXT,
  marital_status        TEXT,
  address               TEXT,
  emergency_contact     TEXT,
  emergency_phone       TEXT,
  iqama_expiry          TEXT,
  license_no            TEXT,
  license_expiry        TEXT,
  basic_salary          REAL    NOT NULL DEFAULT 0,
  housing_allowance     REAL    NOT NULL DEFAULT 0,
  transport_allowance   REAL    NOT NULL DEFAULT 0,
  other_allowance       REAL    NOT NULL DEFAULT 0,
  bank_name             TEXT,
  iban                  TEXT,
  annual_leave_balance  REAL    NOT NULL DEFAULT 21,
  avatar                TEXT,
  last_login_at         TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_employees_dept    ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_employees_manager ON employees(manager_id);
CREATE INDEX IF NOT EXISTS idx_employees_status  ON employees(status);

CREATE TABLE IF NOT EXISTS attendance (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id          INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date                 TEXT    NOT NULL,
  check_in             TEXT,
  check_out            TEXT,
  status               TEXT    NOT NULL DEFAULT 'present',
  work_minutes         INTEGER NOT NULL DEFAULT 0,
  late_minutes         INTEGER NOT NULL DEFAULT 0,
  overtime_minutes     INTEGER NOT NULL DEFAULT 0,
  early_leave_minutes  INTEGER NOT NULL DEFAULT 0,
  source               TEXT    NOT NULL DEFAULT 'portal',
  notes                TEXT,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (employee_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);

CREATE TABLE IF NOT EXISTS leave_types (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  code                 TEXT    NOT NULL UNIQUE,
  name_ar              TEXT    NOT NULL,
  max_days             REAL,
  paid                 INTEGER NOT NULL DEFAULT 1,
  deducts_balance      INTEGER NOT NULL DEFAULT 1,
  requires_attachment  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS leaves (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id    INTEGER NOT NULL REFERENCES employees(id)   ON DELETE CASCADE,
  leave_type_id  INTEGER NOT NULL REFERENCES leave_types(id),
  start_date     TEXT    NOT NULL,
  end_date       TEXT    NOT NULL,
  days           REAL    NOT NULL,
  reason         TEXT,
  attachment     TEXT,
  status         TEXT    NOT NULL DEFAULT 'pending',
  approver_id    INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  decision_note  TEXT,
  decided_at     TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_leaves_employee ON leaves(employee_id);
CREATE INDEX IF NOT EXISTS idx_leaves_status   ON leaves(status);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  year          INTEGER NOT NULL,
  month         INTEGER NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'draft',
  total_gross   REAL    NOT NULL DEFAULT 0,
  total_net     REAL    NOT NULL DEFAULT 0,
  total_gosi_employer REAL NOT NULL DEFAULT 0, -- إجمالي حصة صاحب العمل من التأمينات
  notes         TEXT,
  created_by    INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  approved_by   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  approved_at   TEXT,
  UNIQUE (year, month)
);

CREATE TABLE IF NOT EXISTS payslips (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id               INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id          INTEGER NOT NULL REFERENCES employees(id)    ON DELETE CASCADE,
  basic_salary         REAL NOT NULL DEFAULT 0,
  housing_allowance    REAL NOT NULL DEFAULT 0,
  transport_allowance  REAL NOT NULL DEFAULT 0,
  other_allowance      REAL NOT NULL DEFAULT 0,
  overtime_amount      REAL NOT NULL DEFAULT 0,
  gosi_deduction       REAL NOT NULL DEFAULT 0,   -- حصة الموظف، تُخصم من الصافي
  gosi_employer        REAL NOT NULL DEFAULT 0,   -- حصة صاحب العمل، تكلفة على الشركة
  gosi_total           REAL NOT NULL DEFAULT 0,
  gosi_category        TEXT,                      -- saudi أو non_saudi
  gosi_wage            REAL NOT NULL DEFAULT 0,   -- الوعاء الخاضع للاشتراك
  absence_deduction    REAL NOT NULL DEFAULT 0,
  loan_deduction       REAL NOT NULL DEFAULT 0,
  other_deduction      REAL NOT NULL DEFAULT 0,
  gross_amount         REAL NOT NULL DEFAULT 0,
  net_amount           REAL NOT NULL DEFAULT 0,
  absent_days          REAL NOT NULL DEFAULT 0,
  overtime_hours       REAL NOT NULL DEFAULT 0,
  notes                TEXT,
  UNIQUE (run_id, employee_id)
);

CREATE TABLE IF NOT EXISTS announcements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT    NOT NULL,
  body           TEXT    NOT NULL,
  priority       TEXT    NOT NULL DEFAULT 'normal',
  department_id  INTEGER REFERENCES departments(id) ON DELETE CASCADE,
  pinned         INTEGER NOT NULL DEFAULT 0,
  published_by   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  published_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at     TEXT
);

CREATE TABLE IF NOT EXISTS documents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER REFERENCES employees(id) ON DELETE CASCADE,
  title        TEXT    NOT NULL,
  category     TEXT    NOT NULL DEFAULT 'عام',
  file_name    TEXT    NOT NULL,
  stored_name  TEXT    NOT NULL,
  mime_type    TEXT,
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  visibility   TEXT    NOT NULL DEFAULT 'private',
  expires_at   TEXT,
  uploaded_by  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS service_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type         TEXT    NOT NULL,
  subject      TEXT    NOT NULL,
  details      TEXT,
  amount       REAL,
  status       TEXT    NOT NULL DEFAULT 'pending',
  assignee_id  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  response     TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  decided_at   TEXT
);

CREATE TABLE IF NOT EXISTS vehicles (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  plate_no             TEXT    NOT NULL UNIQUE,
  type                 TEXT    NOT NULL DEFAULT 'شاحنة',
  make_model           TEXT,
  year                 INTEGER,
  capacity_kg          REAL,
  status               TEXT    NOT NULL DEFAULT 'available',
  driver_id            INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  odometer_km          REAL    NOT NULL DEFAULT 0,
  last_maintenance     TEXT,
  next_maintenance     TEXT,
  insurance_expiry     TEXT,
  registration_expiry  TEXT,
  notes                TEXT,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trips (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT    NOT NULL UNIQUE,
  vehicle_id   INTEGER REFERENCES vehicles(id)  ON DELETE SET NULL,
  driver_id    INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  client_name  TEXT,
  origin       TEXT    NOT NULL,
  destination  TEXT    NOT NULL,
  cargo        TEXT,
  weight_kg    REAL,
  distance_km  REAL,
  cost         REAL,
  depart_at    TEXT,
  arrive_at    TEXT,
  status       TEXT    NOT NULL DEFAULT 'planned',
  notes        TEXT,
  created_by   INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);
CREATE INDEX IF NOT EXISTS idx_trips_driver ON trips(driver_id);

CREATE TABLE IF NOT EXISTS notifications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title        TEXT    NOT NULL,
  body         TEXT,
  link         TEXT,
  is_read      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_emp ON notifications(employee_id, is_read);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  action      TEXT    NOT NULL,
  entity      TEXT,
  entity_id   INTEGER,
  details     TEXT,
  ip          TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
