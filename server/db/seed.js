'use strict';

/**
 * تهيئة قاعدة البيانات ببيانات تجريبية لشركة مدد للخدمات اللوجستية.
 * التشغيل: npm run seed   —   لإعادة البناء من الصفر: npm run reset
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { hashPassword } = require('../utils/password');
const dates = require('../utils/dates');

const RESET = process.argv.includes('--reset');
if (RESET && fs.existsSync(config.dbFile)) {
  ['', '-wal', '-shm'].forEach((suffix) => {
    const file = `${config.dbFile}${suffix}`;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  });
  // eslint-disable-next-line no-console
  console.log('تم حذف قاعدة البيانات السابقة.');
}

// يُحمّل بعد الحذف حتى يُنشئ ملفاً جديداً
const db = require('./index');

db.migrate();

const DEFAULT_PASSWORD = process.env.SEED_PASSWORD || 'Madad@2026';

const DEPARTMENTS = [
  { code: 'EXEC', name_ar: 'الإدارة التنفيذية', name_en: 'Executive', cost_center: 'CC-100' },
  { code: 'OPS', name_ar: 'العمليات والنقل', name_en: 'Operations & Transport', cost_center: 'CC-200' },
  { code: 'WH', name_ar: 'المستودعات والتخزين', name_en: 'Warehousing', cost_center: 'CC-210' },
  { code: 'FLT', name_ar: 'إدارة الأسطول', name_en: 'Fleet Management', cost_center: 'CC-220' },
  { code: 'HR', name_ar: 'الموارد البشرية', name_en: 'Human Resources', cost_center: 'CC-300' },
  { code: 'FIN', name_ar: 'الشؤون المالية', name_en: 'Finance', cost_center: 'CC-310' },
  { code: 'CS', name_ar: 'خدمة العملاء', name_en: 'Customer Service', cost_center: 'CC-400' },
  { code: 'IT', name_ar: 'تقنية المعلومات', name_en: 'Information Technology', cost_center: 'CC-500' },
];

const LEAVE_TYPES = [
  { code: 'ANNUAL', name_ar: 'إجازة سنوية', max_days: 30, paid: 1, deducts_balance: 1, requires_attachment: 0 },
  { code: 'SICK', name_ar: 'إجازة مرضية', max_days: 30, paid: 1, deducts_balance: 0, requires_attachment: 1 },
  { code: 'EMERG', name_ar: 'إجازة اضطرارية', max_days: 5, paid: 1, deducts_balance: 1, requires_attachment: 0 },
  { code: 'MARRIAGE', name_ar: 'إجازة زواج', max_days: 5, paid: 1, deducts_balance: 0, requires_attachment: 1 },
  { code: 'PATERNITY', name_ar: 'إجازة مولود', max_days: 3, paid: 1, deducts_balance: 0, requires_attachment: 1 },
  { code: 'BEREAVE', name_ar: 'إجازة وفاة', max_days: 5, paid: 1, deducts_balance: 0, requires_attachment: 0 },
  { code: 'HAJJ', name_ar: 'إجازة حج', max_days: 10, paid: 1, deducts_balance: 0, requires_attachment: 1 },
  { code: 'UNPAID', name_ar: 'إجازة بدون راتب', max_days: 60, paid: 0, deducts_balance: 0, requires_attachment: 0 },
];

const EMPLOYEES = [
  ['1001', 'عبدالله بن سعد المطيري', 'Abdullah Almutairi', 'admin@madad.com.sa', 'admin', 'الرئيس التنفيذي', 'EXEC', 32000, 8000, 2000],
  ['1002', 'نورة بنت فهد العتيبي', 'Noura Alotaibi', 'hr@madad.com.sa', 'hr', 'مدير الموارد البشرية', 'HR', 18000, 4500, 1500],
  ['1003', 'خالد بن محمد الدوسري', 'Khalid Aldosari', 'finance@madad.com.sa', 'finance', 'المدير المالي', 'FIN', 20000, 5000, 1500],
  ['1004', 'ماجد بن علي القحطاني', 'Majed Alqahtani', 'ops@madad.com.sa', 'operations', 'مدير العمليات والنقل', 'OPS', 19000, 4750, 1500],
  ['1005', 'سلطان بن ناصر الحربي', 'Sultan Alharbi', 'fleet@madad.com.sa', 'manager', 'مدير الأسطول', 'FLT', 14000, 3500, 1200],
  ['1006', 'ريم بنت عبدالعزيز الشمري', 'Reem Alshammari', 'warehouse@madad.com.sa', 'manager', 'مدير المستودعات', 'WH', 13000, 3250, 1200],
  ['1007', 'فيصل بن تركي الزهراني', 'Faisal Alzahrani', 'it@madad.com.sa', 'manager', 'مدير تقنية المعلومات', 'IT', 15000, 3750, 1200],
  ['1008', 'هند بنت سالم الغامدي', 'Hind Alghamdi', 'cs@madad.com.sa', 'manager', 'مدير خدمة العملاء', 'CS', 12000, 3000, 1000],
  ['1009', 'محمد بن إبراهيم العنزي', 'Mohammed Alanazi', 'm.alanazi@madad.com.sa', 'employee', 'سائق شاحنة أول', 'OPS', 6500, 1600, 800],
  ['1010', 'سعد بن راشد البقمي', 'Saad Albaqami', 's.albaqami@madad.com.sa', 'employee', 'سائق شاحنة', 'OPS', 5800, 1450, 800],
  ['1011', 'عمر بن يوسف الجهني', 'Omar Aljohani', 'o.aljohani@madad.com.sa', 'employee', 'سائق تريلا', 'OPS', 6200, 1550, 800],
  ['1012', 'بندر بن حمد السبيعي', 'Bandar Alsubaie', 'b.alsubaie@madad.com.sa', 'employee', 'سائق دينا', 'OPS', 5200, 1300, 700],
  ['1013', 'تركي بن مشعل الرشيدي', 'Turki Alrashidi', 't.alrashidi@madad.com.sa', 'employee', 'منسق عمليات نقل', 'OPS', 8500, 2125, 900],
  ['1014', 'أسماء بنت خالد المالكي', 'Asma Almalki', 'a.almalki@madad.com.sa', 'employee', 'أخصائي موارد بشرية', 'HR', 9000, 2250, 900],
  ['1015', 'يزيد بن سليمان الخالدي', 'Yazeed Alkhalidi', 'y.alkhalidi@madad.com.sa', 'employee', 'محاسب', 'FIN', 9500, 2375, 900],
  ['1016', 'لمى بنت عادل الحمدان', 'Lama Alhamdan', 'l.alhamdan@madad.com.sa', 'employee', 'أخصائي خدمة عملاء', 'CS', 7000, 1750, 800],
  ['1017', 'راكان بن فهد العمري', 'Rakan Alomari', 'r.alomari@madad.com.sa', 'employee', 'أمين مستودع', 'WH', 6800, 1700, 800],
  ['1018', 'جواهر بنت منصور القرني', 'Jawaher Alqarni', 'j.alqarni@madad.com.sa', 'employee', 'منسق مستودعات', 'WH', 7200, 1800, 800],
  ['1019', 'عبدالرحمن بن زياد الشهري', 'Abdulrahman Alshehri', 'a.alshehri@madad.com.sa', 'employee', 'فني صيانة مركبات', 'FLT', 6000, 1500, 800],
  ['1020', 'وليد بن عوض البلوي', 'Waleed Albalawi', 'w.albalawi@madad.com.sa', 'employee', 'مهندس دعم فني', 'IT', 10000, 2500, 1000],
];

const VEHICLES = [
  ['ه ط ك 4521', 'تريلا', 'مرسيدس أكتروس 2645', 2022, 40000, 'available', 40, '2026-11-20', '2026-10-15'],
  ['ب ن م 8734', 'شاحنة', 'فولفو FH16', 2021, 25000, 'available', 25, '2026-09-30', '2026-12-01'],
  ['ر س ع 1290', 'شاحنة', 'مان TGX 18.440', 2023, 22000, 'on_trip', 22, '2027-01-15', '2026-08-25'],
  ['د ق ل 6612', 'دينا', 'إيسوزو NPR', 2020, 5000, 'available', 5, '2026-08-10', '2026-09-05'],
  ['ط ح ص 3345', 'دينا', 'هينو 300', 2021, 6000, 'maintenance', 6, '2026-12-22', '2027-02-10'],
  ['ك ل م 7788', 'فان', 'تويوتا هايس', 2023, 1200, 'available', 1.2, '2027-03-01', '2027-01-20'],
  ['س ي ن 9021', 'تريلا', 'سكانيا R500', 2022, 40000, 'available', 40, '2026-10-05', '2026-11-11'],
  ['ج ر ت 5567', 'سيارة نقل خفيف', 'إيسوزو D-Max', 2024, 1000, 'available', 1, '2027-05-18', '2027-04-02'],
];

const CITIES = ['الرياض', 'جدة', 'الدمام', 'مكة المكرمة', 'المدينة المنورة', 'أبها', 'تبوك',
  'الجبيل', 'ينبع', 'القصيم', 'حائل', 'نجران'];

const CLIENTS = ['مجموعة الفهد التجارية', 'شركة البحر الأحمر للتوريدات', 'مصانع الرياض للأغذية',
  'شركة الخليج للمقاولات', 'مؤسسة النخبة للتجارة', 'شركة الوسام للتوزيع'];

const CARGO = ['مواد غذائية مبردة', 'مواد بناء', 'أجهزة كهربائية', 'قطع غيار', 'مستلزمات طبية',
  'أثاث مكتبي', 'مواد تعبئة وتغليف'];

const pick = (arr, i) => arr[i % arr.length];
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function seed() {
  const existing = db.get('SELECT COUNT(*) AS n FROM employees').n;
  if (existing > 0 && !RESET) {
    // eslint-disable-next-line no-console
    console.log(`قاعدة البيانات تحتوي على ${existing} موظف بالفعل. استخدم "npm run reset" لإعادة البناء.`);
    return;
  }

  db.transaction(() => {
    // الأقسام
    DEPARTMENTS.forEach((d) => {
      db.run('INSERT INTO departments (code, name_ar, name_en, cost_center) VALUES (?,?,?,?)',
        [d.code, d.name_ar, d.name_en, d.cost_center]);
    });
    const deptByCode = Object.fromEntries(
      db.all('SELECT id, code FROM departments').map((d) => [d.code, d.id]),
    );

    // أنواع الإجازات
    LEAVE_TYPES.forEach((t) => {
      db.run(
        `INSERT INTO leave_types (code, name_ar, max_days, paid, deducts_balance, requires_attachment)
         VALUES (?,?,?,?,?,?)`,
        [t.code, t.name_ar, t.max_days, t.paid, t.deducts_balance, t.requires_attachment],
      );
    });

    // الموظفون
    const passwordHash = hashPassword(DEFAULT_PASSWORD);
    EMPLOYEES.forEach(([no, nameAr, nameEn, email, role, title, deptCode, basic, housing, transport], i) => {
      const hireDate = dates.addDays(dates.today(), -rand(90, 2200));
      db.run(
        `INSERT INTO employees (employee_no, national_id, full_name_ar, full_name_en, email, phone,
            password_hash, must_change_password, role, job_title, department_id, hire_date,
            contract_type, status, nationality, gender, birth_date, address, emergency_contact,
            emergency_phone, iqama_expiry, basic_salary, housing_allowance, transport_allowance,
            bank_name, iban, annual_leave_balance)
         VALUES (?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [no, `10${String(23456789 + i)}`, nameAr, nameEn, email, `05${rand(10000000, 59999999)}`,
          passwordHash, role, title, deptByCode[deptCode], hireDate,
          'دوام كامل', 'active', 'سعودي',
          /بنت/.test(nameAr) ? 'أنثى' : 'ذكر',
          dates.addDays(hireDate, -rand(7000, 12000)),
          `${pick(CITIES, i)} - حي الملقا`, 'قريب من الدرجة الأولى', `05${rand(10000000, 59999999)}`,
          dates.addDays(dates.today(), rand(20, 500)),
          basic, housing, transport, 'مصرف الراجحي',
          `SA${rand(10, 99)}8000${rand(100000000000000, 999999999999999)}`, 30],
      );
    });

    const employees = db.all('SELECT id, employee_no, department_id, job_title, role FROM employees');
    const byNo = Object.fromEntries(employees.map((e) => [e.employee_no, e]));

    // الهيكل الإداري
    const ceo = byNo['1001'].id;
    const reporting = {
      1002: ceo, 1003: ceo, 1004: ceo, 1005: byNo['1004'].id, 1006: byNo['1004'].id,
      1007: ceo, 1008: ceo, 1009: byNo['1004'].id, 1010: byNo['1004'].id,
      1011: byNo['1004'].id, 1012: byNo['1004'].id, 1013: byNo['1004'].id,
      1014: byNo['1002'].id, 1015: byNo['1003'].id, 1016: byNo['1008'].id,
      1017: byNo['1006'].id, 1018: byNo['1006'].id, 1019: byNo['1005'].id,
      1020: byNo['1007'].id,
    };
    Object.entries(reporting).forEach(([no, managerId]) => {
      db.run('UPDATE employees SET manager_id = ? WHERE employee_no = ?', [managerId, no]);
    });

    // مديرو الأقسام
    [['EXEC', '1001'], ['HR', '1002'], ['FIN', '1003'], ['OPS', '1004'],
      ['FLT', '1005'], ['WH', '1006'], ['IT', '1007'], ['CS', '1008']].forEach(([code, no]) => {
      db.run('UPDATE departments SET manager_id = ? WHERE code = ?', [byNo[no].id, code]);
    });

    // المركبات
    const drivers = employees.filter((e) => /سائق/.test(e.job_title || ''));
    VEHICLES.forEach((v, i) => {
      const [plate, type, model, year, capacity, status, odoFactor, insurance, registration] = v;
      db.run(
        `INSERT INTO vehicles (plate_no, type, make_model, year, capacity_kg, status, driver_id,
            odometer_km, last_maintenance, next_maintenance, insurance_expiry, registration_expiry)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [plate, type, model, year, capacity, status,
          drivers.length ? drivers[i % drivers.length].id : null,
          rand(30000, 260000), dates.addDays(dates.today(), -rand(20, 120)),
          dates.addDays(dates.today(), rand(-5, 90)), insurance, registration],
      );
    });

    // سجلات الحضور لآخر 45 يوماً
    const attendanceEmployees = db.all("SELECT id FROM employees WHERE status = 'active'");
    for (let d = 45; d >= 0; d -= 1) {
      const date = dates.addDays(dates.today(), -d);
      if (dates.isWeekend(date)) continue;

      attendanceEmployees.forEach((employee) => {
        const roll = Math.random();
        if (roll < 0.04) {
          db.run(
            "INSERT OR IGNORE INTO attendance (employee_id, date, status, source) VALUES (?,?,'absent','system')",
            [employee.id, date],
          );
          return;
        }

        const late = roll < 0.18;
        const checkInMinutes = 8 * 60 + (late ? rand(20, 75) : rand(-25, 12));
        const workMinutes = rand(8 * 60, 10 * 60);
        const checkOutMinutes = checkInMinutes + workMinutes;
        const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        const lateMinutes = Math.max(0, checkInMinutes - (8 * 60 + 15));

        db.run(
          `INSERT OR IGNORE INTO attendance (employee_id, date, check_in, check_out, status,
              work_minutes, late_minutes, overtime_minutes, source)
           VALUES (?,?,?,?,?,?,?,?, 'portal')`,
          [employee.id, date, fmt(checkInMinutes), fmt(checkOutMinutes),
            lateMinutes > 0 ? 'late' : 'present', workMinutes, lateMinutes,
            Math.max(0, checkOutMinutes - 17 * 60)],
        );
      });
    }

    // طلبات إجازة
    const leaveTypes = db.all('SELECT id, code, name_ar FROM leave_types');
    const sampleLeaves = [
      ['1009', 'ANNUAL', -12, -6, 'approved', 'إجازة سنوية مخططة'],
      ['1010', 'SICK', -20, -18, 'approved', 'إجازة مرضية بتقرير طبي'],
      ['1016', 'ANNUAL', 12, 20, 'pending', 'سفر عائلي'],
      ['1013', 'EMERG', 3, 4, 'pending', 'ظرف عائلي طارئ'],
      ['1017', 'ANNUAL', -40, -35, 'approved', 'إجازة سنوية'],
      ['1019', 'MARRIAGE', 25, 29, 'pending', 'زواج'],
      ['1011', 'ANNUAL', -60, -50, 'rejected', 'تعارض مع جدول الرحلات'],
      ['1020', 'ANNUAL', 40, 47, 'pending', 'إجازة سنوية'],
    ];

    sampleLeaves.forEach(([no, typeCode, startOffset, endOffset, status, reason]) => {
      const type = leaveTypes.find((t) => t.code === typeCode);
      const start = dates.addDays(dates.today(), startOffset);
      const end = dates.addDays(dates.today(), endOffset);
      db.run(
        `INSERT INTO leaves (employee_id, leave_type_id, start_date, end_date, days, reason,
            status, approver_id, decided_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [byNo[no].id, type.id, start, end, dates.daysBetween(start, end), reason, status,
          status === 'pending' ? null : byNo['1002'].id,
          status === 'pending' ? null : dates.nowStamp()],
      );
    });

    // طلبات الخدمات
    const sampleRequests = [
      ['1014', 'خطاب تعريف', 'خطاب تعريف لجهة حكومية', 'مطلوب لإصدار رخصة قيادة', null, 'approved'],
      ['1016', 'سلفة', 'طلب سلفة مالية', 'سلفة تُخصم على دفعة واحدة', 5000, 'pending'],
      ['1010', 'شهادة راتب', 'شهادة راتب موجهة للبنك', 'لغرض تمويل عقاري', null, 'in_progress'],
      ['1018', 'تعديل بيانات', 'تحديث رقم الجوال', 'الرقم الجديد 0551234567', null, 'approved'],
      ['1012', 'سلفة', 'طلب سلفة', 'ظرف عائلي', 3000, 'approved'],
      ['1020', 'شكوى أو اقتراح', 'اقتراح تحسين نظام تتبع الشحنات', 'إضافة تتبع لحظي للعملاء', null, 'pending'],
      ['1009', 'خطاب تعريف', 'خطاب تعريف لتجديد رخصة القيادة', 'موجّه لإدارة المرور', null, 'approved'],
      ['1009', 'شهادة راتب', 'شهادة راتب للبنك', 'لغرض فتح حساب ادخار', null, 'pending'],
      ['1011', 'تعديل بيانات', 'تحديث بيانات الحساب البنكي', 'تغيير الآيبان', null, 'in_progress'],
    ];

    sampleRequests.forEach(([no, type, subject, details, amount, status]) => {
      db.run(
        `INSERT INTO service_requests (employee_id, type, subject, details, amount, status,
            assignee_id, decided_at, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [byNo[no].id, type, subject, details, amount, status,
          status === 'pending' ? null : byNo['1002'].id,
          status === 'pending' ? null : dates.nowStamp(),
          `${dates.addDays(dates.today(), -rand(1, 25))} 09:${rand(10, 59)}:00`],
      );
    });

    // الرحلات
    const vehicles = db.all('SELECT id, plate_no FROM vehicles');
    const statuses = ['completed', 'completed', 'completed', 'in_progress', 'planned', 'planned', 'delayed'];
    const year = new Date().getFullYear();

    for (let i = 1; i <= 60; i += 1) {
      const origin = pick(CITIES, i);
      let destination = pick(CITIES, i + 3);
      if (destination === origin) destination = pick(CITIES, i + 5);

      const status = pick(statuses, i);
      const dayOffset = status === 'planned' ? rand(1, 14) : -rand(0, 45);
      const departDate = dates.addDays(dates.today(), dayOffset);

      db.run(
        `INSERT INTO trips (code, vehicle_id, driver_id, client_name, origin, destination, cargo,
            weight_kg, distance_km, cost, depart_at, arrive_at, status, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [`TRP-${year}-${String(i).padStart(4, '0')}`,
          vehicles[i % vehicles.length].id,
          drivers.length ? drivers[i % drivers.length].id : null,
          pick(CLIENTS, i), origin, destination, pick(CARGO, i),
          rand(2000, 38000), rand(120, 1400), rand(1800, 14000),
          `${departDate} 0${rand(4, 9)}:00:00`,
          status === 'completed' ? `${dates.addDays(departDate, 1)} 1${rand(0, 9)}:30:00` : null,
          status, byNo['1004'].id, `${dates.addDays(departDate, -2)} 10:00:00`],
      );
    }

    // الإعلانات
    const announcements = [
      ['تحديث سياسة الحضور والانصراف', 'اعتباراً من بداية الشهر القادم يبدأ الدوام الرسمي الساعة 8:00 صباحاً وينتهي 5:00 مساءً، مع فترة سماح 15 دقيقة. يرجى الالتزام بتسجيل الحضور والانصراف عبر البوابة.', 'high', 1],
      ['إطلاق بوابة الموظفين الجديدة', 'يسر إدارة الموارد البشرية إعلان إطلاق بوابة الموظفين المتكاملة، والتي تتيح تسجيل الحضور، تقديم طلبات الإجازات، الاطلاع على إشعارات الرواتب، ومتابعة الرحلات وطلبات الخدمات إلكترونياً.', 'urgent', 1],
      ['برنامج السلامة المرورية لسائقي الأسطول', 'تنظّم إدارة الأسطول برنامجاً تدريبياً في السلامة المرورية لجميع السائقين. الحضور إلزامي، وسيتم التنسيق مع كل سائق بخصوص الموعد المناسب.', 'high', 0],
      ['جدول صرف الرواتب', 'يتم صرف الرواتب في اليوم الـ 27 من كل شهر ميلادي. في حال تعارض الموعد مع عطلة رسمية يتم الصرف في يوم العمل السابق له.', 'normal', 0],
      ['تحديث بيانات الاتصال', 'نرجو من جميع الموظفين تحديث أرقام الجوال وبيانات الاتصال في حالات الطوارئ من خلال صفحة الملف الشخصي في البوابة.', 'normal', 0],
    ];

    announcements.forEach(([title, body, priority, pinned]) => {
      db.run(
        `INSERT INTO announcements (title, body, priority, pinned, published_by, published_at)
         VALUES (?,?,?,?,?,?)`,
        [title, body, priority, pinned, byNo['1002'].id,
          `${dates.addDays(dates.today(), -rand(1, 30))} 08:30:00`],
      );
    });

    // مستندات عامة (سياسات ونماذج)
    const policies = [
      ['سياسة الحضور والانصراف', 'سياسات', 'attendance-policy.txt',
        'سياسة الحضور والانصراف — شركة مدد للخدمات اللوجستية\n\n'
        + '1. الدوام الرسمي من الساعة 08:00 صباحاً حتى 05:00 مساءً.\n'
        + '2. فترة السماح 15 دقيقة، وما بعدها يُحتسب تأخيراً.\n'
        + '3. يلتزم الموظف بتسجيل الحضور والانصراف عبر بوابة الموظفين.\n'
        + '4. أي تعديل يدوي على سجل الحضور يتم عبر إدارة الموارد البشرية.\n'],
      ['لائحة الإجازات', 'سياسات', 'leave-policy.txt',
        'لائحة الإجازات — شركة مدد للخدمات اللوجستية\n\n'
        + '1. رصيد الإجازة السنوية 30 يوماً لكل موظف.\n'
        + '2. تُقدَّم طلبات الإجازة عبر البوابة قبل موعدها بوقت كافٍ.\n'
        + '3. الإجازة المرضية تتطلب إرفاق تقرير طبي معتمد.\n'
        + '4. تخضع الإجازات لاعتماد المدير المباشر وإدارة الموارد البشرية.\n'],
      ['دليل السلامة المرورية للسائقين', 'سياسات', 'driver-safety.txt',
        'دليل السلامة المرورية — إدارة الأسطول\n\n'
        + '1. الفحص اليومي للمركبة قبل انطلاق أي رحلة.\n'
        + '2. الالتزام بالسرعات النظامية وأوقات الراحة بين الرحلات.\n'
        + '3. الإبلاغ الفوري عن أي عطل أو حادث عبر البوابة.\n'
        + '4. عدم تجاوز الحمولة القصوى المصرّح بها للمركبة.\n'],
      ['نموذج طلب خطاب تعريف', 'خطابات', 'intro-letter-form.txt',
        'نموذج طلب خطاب تعريف\n\n'
        + 'الاسم: ....................\nالرقم الوظيفي: ....................\n'
        + 'الجهة الموجّه إليها الخطاب: ....................\nالغرض: ....................\n\n'
        + 'يمكن تقديم الطلب إلكترونياً من صفحة "طلبات الخدمات" في البوابة.\n'],
    ];

    policies.forEach(([title, category, fileName, content]) => {
      const storedName = `seed-${fileName}`;
      fs.writeFileSync(path.join(config.uploadsDir, storedName), content, 'utf8');
      db.run(
        `INSERT INTO documents (employee_id, title, category, file_name, stored_name, mime_type,
            size_bytes, visibility, uploaded_by)
         VALUES (NULL, ?, ?, ?, ?, 'text/plain', ?, 'public', ?)`,
        [title, category, fileName, storedName, Buffer.byteLength(content, 'utf8'), byNo['1002'].id],
      );
    });

    // الإعدادات
    const settings = {
      'company.name_ar': config.company.nameAr,
      'company.name_en': config.company.nameEn,
      'company.logo_text': 'مدد',
      'work.start_time': '08:00',
      'work.end_time': '17:00',
      'work.grace_minutes': '15',
      'payroll.gosi_rate': '0.0975',
      'payroll.pay_day': '27',
    };
    Object.entries(settings).forEach(([key, value]) => {
      db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', [key, value]);
    });

    // إشعارات ترحيبية
    employees.forEach((e) => {
      db.run(
        'INSERT INTO notifications (employee_id, title, body, link) VALUES (?,?,?,?)',
        [e.id, `مرحباً بك في بوابة ${config.company.shortAr}`,
          'يمكنك الآن تسجيل الحضور وتقديم الطلبات ومتابعة بياناتك الوظيفية.', '#/dashboard'],
      );
    });
  });

  // مسيّر رواتب للشهر الماضي
  const { computePayslip } = require('../routes/payroll');
  const previous = new Date();
  previous.setMonth(previous.getMonth() - 1);
  const pYear = previous.getFullYear();
  const pMonth = previous.getMonth() + 1;

  if (!db.get('SELECT id FROM payroll_runs WHERE year = ? AND month = ?', [pYear, pMonth])) {
    const creator = db.get("SELECT id FROM employees WHERE role = 'finance' LIMIT 1");
    db.transaction(() => {
      const info = db.run(
        "INSERT INTO payroll_runs (year, month, status, created_by) VALUES (?,?,'approved',?)",
        [pYear, pMonth, creator ? creator.id : null],
      );
      const runId = Number(info.lastInsertRowid);
      let gross = 0;
      let net = 0;

      db.all("SELECT * FROM employees WHERE status = 'active'").forEach((employee) => {
        const slip = computePayslip(employee, pYear, pMonth);
        gross += slip.gross_amount;
        net += slip.net_amount;
        db.run(
          `INSERT INTO payslips (run_id, employee_id, basic_salary, housing_allowance,
              transport_allowance, other_allowance, overtime_amount, gosi_deduction,
              absence_deduction, loan_deduction, other_deduction, gross_amount, net_amount,
              absent_days, overtime_hours)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [runId, employee.id, slip.basic_salary, slip.housing_allowance, slip.transport_allowance,
            slip.other_allowance, slip.overtime_amount, slip.gosi_deduction, slip.absence_deduction,
            slip.loan_deduction, slip.other_deduction, slip.gross_amount, slip.net_amount,
            slip.absent_days, slip.overtime_hours],
        );
      });

      db.run(
        `UPDATE payroll_runs SET total_gross = ?, total_net = ?, approved_by = ?,
                approved_at = datetime('now') WHERE id = ?`,
        [Math.round(gross * 100) / 100, Math.round(net * 100) / 100, creator ? creator.id : null, runId],
      );
    });
  }

  const counts = {
    الموظفون: db.get('SELECT COUNT(*) AS n FROM employees').n,
    الأقسام: db.get('SELECT COUNT(*) AS n FROM departments').n,
    'سجلات الحضور': db.get('SELECT COUNT(*) AS n FROM attendance').n,
    'طلبات الإجازات': db.get('SELECT COUNT(*) AS n FROM leaves').n,
    المركبات: db.get('SELECT COUNT(*) AS n FROM vehicles').n,
    الرحلات: db.get('SELECT COUNT(*) AS n FROM trips').n,
  };

  /* eslint-disable no-console */
  console.log('\nتمت تهيئة قاعدة البيانات بنجاح:');
  Object.entries(counts).forEach(([label, value]) => console.log(`  - ${label}: ${value}`));
  console.log('\nحسابات الدخول التجريبية (كلمة المرور موحّدة):');
  console.log(`  كلمة المرور: ${DEFAULT_PASSWORD}`);
  console.log('  admin@madad.com.sa    — مدير النظام');
  console.log('  hr@madad.com.sa       — الموارد البشرية');
  console.log('  finance@madad.com.sa  — الشؤون المالية');
  console.log('  ops@madad.com.sa      — إدارة العمليات');
  console.log('  fleet@madad.com.sa    — مدير مباشر (الأسطول)');
  console.log('  m.alanazi@madad.com.sa— موظف / سائق\n');
  /* eslint-enable no-console */
}

seed();
