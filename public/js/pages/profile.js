/* الملف الشخصي */
(function registerProfile(global) {
  'use strict';

  global.PAGES = global.PAGES || {};

  function row(key, value) {
    return `<div class="row"><span class="k">${key}</span><span class="v">${value || '—'}</span></div>`;
  }

  global.PAGES.profile = {
    async render(container, App) {
      const employeeId = App.params.id && App.hasRole('admin', 'hr', 'finance', 'manager')
        ? Number(App.params.id)
        : App.user.id;
      const isSelf = employeeId === App.user.id;

      const [profile, balance, attendance] = await Promise.all([
        api.get(`/employees/${employeeId}`),
        api.get(`/leaves/balance/${employeeId}`),
        api.get(`/attendance/summary/${employeeId}`),
      ]);

      const e = profile.data;
      const b = balance.data;
      const a = attendance.data;

      container.innerHTML = `
        <div class="card">
          <div class="card-body profile-head">
            <div class="avatar-lg">${ui.initials(e.full_name_ar)}</div>
            <div style="flex:1;min-width:220px">
              <h2 class="mb-0">${ui.esc(e.full_name_ar)}</h2>
              <div class="muted">${ui.esc(e.job_title || '')} — ${ui.esc(e.department_name || 'بدون قسم')}</div>
              <div class="mt-1 flex flex-wrap">
                <span class="badge brand">${ui.esc(e.employee_no)}</span>
                <span class="badge neutral">${ui.role(e.role)}</span>
                ${ui.status(e.status)}
              </div>
            </div>
            <div class="btn-row">
              ${isSelf ? '<button class="btn secondary" id="edit-self">تعديل بياناتي</button>' : ''}
              ${App.hasRole('admin', 'hr') ? `<a class="btn secondary" href="#/employees?edit=${e.id}">تعديل الملف</a>` : ''}
            </div>
          </div>
        </div>

        <div class="grid grid-4 mb-2">
          ${ui.stat('🌴', 'رصيد الإجازات', `${ui.number(b.remaining)} يوم`, `مستهلك ${ui.number(b.used)}`, 'info')}
          ${ui.stat('✅', 'أيام حضور الشهر', ui.number(a.present_days || 0), `من ${ui.number(a.working_days)} يوم عمل`, 'ok')}
          ${ui.stat('⏰', 'دقائق التأخير', ui.number(a.late_minutes || 0), `${ui.number(a.late_days || 0)} يوم تأخير`, 'warn')}
          ${ui.stat('🕐', 'ساعات العمل', ui.duration(a.work_minutes || 0), 'خلال الشهر الحالي')}
        </div>

        <div class="grid grid-2">
          <div class="card">
            <div class="card-head"><h3>البيانات الوظيفية</h3></div>
            <div class="card-body">
              <div class="info-list">
                ${row('الرقم الوظيفي', ui.esc(e.employee_no))}
                ${row('المسمى الوظيفي', ui.esc(e.job_title))}
                ${row('القسم', ui.esc(e.department_name))}
                ${row('المدير المباشر', ui.esc(e.manager_name))}
                ${row('تاريخ التعيين', ui.date(e.hire_date))}
                ${row('نوع العقد', ui.esc(e.contract_type))}
                ${row('حالة الموظف', ui.statusText(e.status))}
                ${row('آخر دخول', ui.dateTime(e.last_login_at))}
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h3>البيانات الشخصية</h3></div>
            <div class="card-body">
              <div class="info-list">
                ${row('الاسم بالإنجليزية', ui.esc(e.full_name_en))}
                ${row('البريد الإلكتروني', ui.esc(e.email))}
                ${row('رقم الجوال', ui.esc(e.phone))}
                ${row('الجنسية', ui.esc(e.nationality))}
                ${row('تاريخ الميلاد', ui.date(e.birth_date))}
                ${row('العنوان', ui.esc(e.address))}
                ${row('جهة الاتصال للطوارئ', ui.esc(e.emergency_contact))}
                ${row('جوال الطوارئ', ui.esc(e.emergency_phone))}
                ${e.iqama_expiry ? row('انتهاء الإقامة', ui.date(e.iqama_expiry)) : ''}
                ${e.license_no ? row('رقم رخصة القيادة', ui.esc(e.license_no)) : ''}
                ${e.license_expiry ? row('انتهاء الرخصة', ui.date(e.license_expiry)) : ''}
              </div>
            </div>
          </div>

          ${e.basic_salary !== undefined ? `
            <div class="card">
              <div class="card-head"><h3>البيانات المالية</h3></div>
              <div class="card-body">
                <div class="info-list">
                  ${row('الراتب الأساسي', `<span class="money">${ui.money(e.basic_salary)}</span>`)}
                  ${row('بدل السكن', `<span class="money">${ui.money(e.housing_allowance)}</span>`)}
                  ${row('بدل النقل', `<span class="money">${ui.money(e.transport_allowance)}</span>`)}
                  ${row('بدلات أخرى', `<span class="money">${ui.money(e.other_allowance)}</span>`)}
                  ${row('إجمالي الاستحقاق', `<span class="money">${ui.money(
    (e.basic_salary || 0) + (e.housing_allowance || 0) + (e.transport_allowance || 0) + (e.other_allowance || 0),
  )}</span>`)}
                  ${row('البنك', ui.esc(e.bank_name))}
                  ${row('الآيبان', `<span dir="ltr">${ui.esc(e.iban)}</span>`)}
                </div>
              </div>
            </div>` : ''}

          <div class="card">
            <div class="card-head"><h3>الفريق المرتبط</h3></div>
            <div class="card-body tight">
              ${ui.table([
    { title: 'الاسم', render: (r) => `<a href="#/profile?id=${r.id}">${ui.esc(r.full_name_ar)}</a>` },
    { title: 'المسمى الوظيفي', key: 'job_title' },
  ], e.direct_reports, 'لا يوجد موظفون تابعون')}
            </div>
          </div>
        </div>`;

      const editButton = container.querySelector('#edit-self');
      if (editButton) editButton.addEventListener('click', () => editSelfDialog(e, App));
    },
  };

  function editSelfDialog(employee, App) {
    const modal = ui.modal('تعديل بياناتي', `
      <form id="self-form">
        <div class="form-grid">
          <div class="field">
            <label>رقم الجوال</label>
            <input type="text" name="phone" value="${ui.esc(employee.phone || '')}" dir="ltr">
          </div>
          <div class="field">
            <label>الحالة الاجتماعية</label>
            <select name="marital_status">
              ${['', 'أعزب', 'متزوج', 'مطلق', 'أرمل'].map((v) => `<option value="${v}" ${employee.marital_status === v ? 'selected' : ''}>${v || '— اختر —'}</option>`).join('')}
            </select>
          </div>
          <div class="field full">
            <label>العنوان</label>
            <input type="text" name="address" value="${ui.esc(employee.address || '')}">
          </div>
          <div class="field">
            <label>جهة الاتصال للطوارئ</label>
            <input type="text" name="emergency_contact" value="${ui.esc(employee.emergency_contact || '')}">
          </div>
          <div class="field">
            <label>جوال الطوارئ</label>
            <input type="text" name="emergency_phone" value="${ui.esc(employee.emergency_phone || '')}" dir="ltr">
          </div>
        </div>
        <p class="small muted mb-0">لتعديل البيانات الوظيفية أو المالية يرجى التواصل مع إدارة الموارد البشرية.</p>
      </form>`, {
      footer: '<button class="btn" form="self-form" type="submit">حفظ التعديلات</button>',
    });

    modal.el.querySelector('#self-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const result = await api.put(`/employees/${employee.id}`, ui.formData(event.target));
        modal.close();
        ui.toast(result.message, 'success');
        App.refresh();
      } catch (error) { ui.fail(error); }
    });
  }
}(window));
