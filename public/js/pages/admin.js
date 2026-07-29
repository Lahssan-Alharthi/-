/* إعدادات النظام وسجل النشاط */
(function registerAdmin(global) {
  'use strict';

  global.PAGES = global.PAGES || {};

  const ACTION_LABELS = {
    login: 'تسجيل دخول',
    logout: 'تسجيل خروج',
    create: 'إنشاء',
    update: 'تعديل',
    delete: 'حذف',
    upsert: 'حفظ',
    approve: 'اعتماد',
    reject: 'رفض',
    decide: 'بتّ في طلب',
    cancel: 'إلغاء',
    terminate: 'إنهاء خدمة',
    check_in: 'تسجيل حضور',
    check_out: 'تسجيل انصراف',
    manual_attendance: 'إدخال حضور يدوي',
    reset_password: 'إعادة تعيين كلمة مرور',
    change_password: 'تغيير كلمة المرور',
    upload: 'رفع ملف',
    download: 'تنزيل ملف',
    maintenance: 'تسجيل صيانة',
    status_change: 'تغيير حالة',
  };

  const ENTITY_LABELS = {
    employees: 'الموظفون',
    departments: 'الأقسام',
    attendance: 'الحضور',
    leaves: 'الإجازات',
    leave_types: 'أنواع الإجازات',
    payroll_runs: 'مسيّرات الرواتب',
    announcements: 'الإعلانات',
    documents: 'المستندات',
    service_requests: 'طلبات الخدمات',
    vehicles: 'المركبات',
    trips: 'الرحلات',
    settings: 'الإعدادات',
  };

  function leaveTypeDialog(App) {
    const modal = ui.modal('إضافة / تعديل نوع إجازة', `
      <form id="lt-form">
        <div class="form-grid">
          <div class="field">
            <label>الرمز *</label>
            <input type="text" name="code" required dir="ltr" placeholder="STUDY">
            <div class="hint">إذا كان الرمز موجوداً سيتم تحديث النوع الحالي.</div>
          </div>
          <div class="field">
            <label>الاسم بالعربية *</label>
            <input type="text" name="name_ar" required placeholder="إجازة دراسية">
          </div>
          <div class="field">
            <label>الحد الأقصى (يوم)</label>
            <input type="number" name="max_days" min="0" step="0.5">
          </div>
          <div class="field">
            <label>&nbsp;</label>
            <label class="checkbox"><input type="checkbox" name="paid" checked> إجازة مدفوعة</label>
          </div>
          <div class="field">
            <label>&nbsp;</label>
            <label class="checkbox"><input type="checkbox" name="deducts_balance" checked> تُخصم من الرصيد السنوي</label>
          </div>
          <div class="field">
            <label>&nbsp;</label>
            <label class="checkbox"><input type="checkbox" name="requires_attachment"> تتطلب مرفقاً</label>
          </div>
        </div>
      </form>`, {
      footer: '<button class="btn" form="lt-form" type="submit">حفظ</button>',
    });

    modal.el.querySelector('#lt-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const result = await api.post('/settings/leave-types', ui.formData(event.target));
        modal.close();
        ui.toast(result.message, 'success');
        App.refresh();
      } catch (error) { ui.fail(error); }
    });
  }

  global.PAGES.admin = {
    async render(container, App) {
      if (!App.hasRole('admin')) {
        container.innerHTML = ui.empty('هذه الصفحة متاحة لمدير النظام فقط', '🔒');
        return;
      }

      const [settingsResult, auditResult, typesResult] = await Promise.all([
        api.get('/settings'),
        api.get('/audit?limit=150'),
        api.get('/leaves/types'),
      ]);

      const settings = settingsResult.data;
      const logs = auditResult.data;

      container.innerHTML = `
        <div class="grid grid-2">
          <div class="card">
            <div class="card-head"><h3>بيانات الشركة</h3></div>
            <div class="card-body">
              <form id="company-form">
                <div class="field">
                  <label>اسم الشركة بالعربية</label>
                  <input type="text" name="company.name_ar" value="${ui.esc(settings['company.name_ar'] || '')}">
                </div>
                <div class="field">
                  <label>اسم الشركة بالإنجليزية</label>
                  <input type="text" name="company.name_en" value="${ui.esc(settings['company.name_en'] || '')}" dir="ltr">
                </div>
                <div class="field">
                  <label>الاسم المختصر (الشعار)</label>
                  <input type="text" name="company.logo_text" value="${ui.esc(settings['company.logo_text'] || '')}">
                </div>
                <button class="btn" type="submit">حفظ</button>
              </form>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h3>سياسة الدوام والرواتب</h3></div>
            <div class="card-body">
              <form id="work-form">
                <div class="form-grid">
                  <div class="field">
                    <label>بداية الدوام</label>
                    <input type="time" name="work.start_time" value="${ui.esc(settings['work.start_time'] || '08:00')}">
                  </div>
                  <div class="field">
                    <label>نهاية الدوام</label>
                    <input type="time" name="work.end_time" value="${ui.esc(settings['work.end_time'] || '17:00')}">
                  </div>
                  <div class="field">
                    <label>فترة السماح (دقيقة)</label>
                    <input type="number" name="work.grace_minutes" min="0" max="120"
                           value="${ui.esc(settings['work.grace_minutes'] || '15')}">
                  </div>
                  <div class="field">
                    <label>يوم صرف الراتب</label>
                    <input type="number" name="payroll.pay_day" min="1" max="31"
                           value="${ui.esc(settings['payroll.pay_day'] || '27')}">
                  </div>
                </div>
                <button class="btn" type="submit">حفظ</button>
              </form>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <h3>أنواع الإجازات</h3><div class="spacer"></div>
            <button class="btn accent" id="add-type">+ نوع إجازة</button>
          </div>
          <div class="card-body tight">
            ${ui.table([
    { title: 'الرمز', key: 'code' },
    { title: 'الاسم', key: 'name_ar' },
    { title: 'الحد الأقصى', render: (r) => (r.max_days ? `${ui.number(r.max_days)} يوم` : 'غير محدد') },
    { title: 'مدفوعة', render: (r) => (r.paid ? 'نعم' : 'لا') },
    { title: 'تُخصم من الرصيد', render: (r) => (r.deducts_balance ? 'نعم' : 'لا') },
    { title: 'تتطلب مرفقاً', render: (r) => (r.requires_attachment ? 'نعم' : 'لا') },
    { title: '', render: (r) => `<button class="btn sm danger" data-del-type="${r.id}">حذف</button>` },
  ], typesResult.data)}
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <h3>سجل نشاط النظام</h3><div class="spacer"></div>
            <span class="muted small">آخر ${ui.number(logs.length)} حدث</span>
          </div>
          <div class="card-body tight">
            ${ui.table([
    { title: 'الوقت', render: (r) => ui.dateTime(r.created_at) },
    { title: 'المستخدم', render: (r) => (r.actor_name ? ui.esc(r.actor_name) : '<span class="muted">النظام</span>') },
    { title: 'الإجراء', render: (r) => `<span class="badge brand">${ACTION_LABELS[r.action] || ui.esc(r.action)}</span>` },
    { title: 'الوحدة', render: (r) => (ENTITY_LABELS[r.entity] || r.entity || '—') },
    { title: 'المعرّف', cls: 'num', render: (r) => (r.entity_id ? `#${r.entity_id}` : '—') },
    { title: 'التفاصيل', cls: 'wrap', render: (r) => `<span class="small muted">${ui.esc(r.details || '')}</span>` },
    { title: 'IP', render: (r) => `<span class="small muted" dir="ltr">${ui.esc(r.ip || '')}</span>` },
  ], logs, 'لا توجد أحداث مسجّلة')}
          </div>
        </div>`;

      const saveSettings = async (form) => {
        try {
          const result = await api.put('/settings', ui.formData(form));
          ui.toast(result.message, 'success');
        } catch (error) { ui.fail(error); }
      };

      container.querySelector('#company-form').addEventListener('submit', (event) => {
        event.preventDefault();
        saveSettings(event.target);
      });

      container.querySelector('#work-form').addEventListener('submit', (event) => {
        event.preventDefault();
        saveSettings(event.target);
      });

      container.querySelector('#add-type').addEventListener('click', () => leaveTypeDialog(App));

      container.querySelectorAll('[data-del-type]').forEach((button) => {
        button.addEventListener('click', async () => {
          const ok = await ui.confirm('حذف نوع الإجازة',
            'لا يمكن الحذف إذا كان النوع مرتبطاً بطلبات قائمة.', 'حذف');
          if (!ok) return;
          try {
            const result = await api.del(`/settings/leave-types/${button.dataset.delType}`);
            ui.toast(result.message, 'success');
            App.refresh();
          } catch (error) { ui.fail(error); }
        });
      });
    },
  };
}(window));
