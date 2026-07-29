/* شؤون الموظفين */
(function registerEmployees(global) {
  'use strict';

  global.PAGES = global.PAGES || {};

  const CONTRACTS = ['دوام كامل', 'دوام جزئي', 'عقد مؤقت', 'تدريب'];
  const NATIONALITIES = ['سعودي', 'مصري', 'هندي', 'باكستاني', 'بنغلاديشي', 'سوري', 'يمني',
    'سوداني', 'أردني', 'فلبيني', 'نيبالي', 'سريلانكي', 'تونسي', 'مغربي', 'لبناني'];
  const ROLES = [
    ['employee', 'موظف'], ['manager', 'مدير مباشر'], ['operations', 'إدارة العمليات'],
    ['hr', 'الموارد البشرية'], ['finance', 'الشؤون المالية'], ['admin', 'مدير النظام'],
  ];

  let departments = [];
  let managers = [];

  function formHtml(employee, App) {
    const e = employee || {};
    const canEditRole = App.hasRole('admin', 'hr');

    return `
      <form id="employee-form">
        <div class="tabs" id="form-tabs">
          <button type="button" class="active" data-tab="basic">البيانات الأساسية</button>
          <button type="button" data-tab="job">البيانات الوظيفية</button>
          <button type="button" data-tab="salary">الراتب والبنك</button>
          <button type="button" data-tab="personal">بيانات شخصية</button>
        </div>

        <div data-panel="basic">
          <div class="form-grid">
            <div class="field">
              <label>الاسم الكامل بالعربية *</label>
              <input type="text" name="full_name_ar" required value="${ui.esc(e.full_name_ar || '')}">
            </div>
            <div class="field">
              <label>الاسم بالإنجليزية</label>
              <input type="text" name="full_name_en" value="${ui.esc(e.full_name_en || '')}" dir="ltr">
            </div>
            <div class="field">
              <label>البريد الإلكتروني *</label>
              <input type="email" name="email" required value="${ui.esc(e.email || '')}" dir="ltr">
            </div>
            <div class="field">
              <label>رقم الجوال</label>
              <input type="text" name="phone" value="${ui.esc(e.phone || '')}" dir="ltr">
            </div>
            <div class="field">
              <label>الرقم الوظيفي</label>
              <input type="text" name="employee_no" value="${ui.esc(e.employee_no || '')}" dir="ltr"
                     placeholder="يُولَّد تلقائياً إن ترك فارغاً">
            </div>
            <div class="field">
              <label>رقم الهوية / الإقامة</label>
              <input type="text" name="national_id" value="${ui.esc(e.national_id || '')}" dir="ltr">
            </div>
          </div>
        </div>

        <div data-panel="job" class="hidden">
          <div class="form-grid">
            <div class="field">
              <label>المسمى الوظيفي</label>
              <input type="text" name="job_title" value="${ui.esc(e.job_title || '')}">
            </div>
            <div class="field">
              <label>القسم</label>
              <select name="department_id">
                <option value="">— بدون قسم —</option>
                ${ui.options(departments, 'id', 'name_ar', e.department_id)}
              </select>
            </div>
            <div class="field">
              <label>المدير المباشر</label>
              <select name="manager_id">
                <option value="">— بدون —</option>
                ${ui.options(managers.filter((m) => m.id !== e.id), 'id', 'full_name_ar', e.manager_id)}
              </select>
            </div>
            <div class="field">
              <label>الدور في النظام</label>
              <select name="role" ${canEditRole ? '' : 'disabled'}>
                ${ROLES.map(([value, label]) => `<option value="${value}" ${e.role === value ? 'selected' : ''}>${label}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>تاريخ التعيين</label>
              <input type="date" name="hire_date" value="${ui.esc((e.hire_date || '').slice(0, 10))}">
            </div>
            <div class="field">
              <label>نوع العقد</label>
              <select name="contract_type">
                ${CONTRACTS.map((c) => `<option value="${c}" ${e.contract_type === c ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>حالة الموظف</label>
              <select name="status">
                ${[['active', 'على رأس العمل'], ['suspended', 'موقوف'], ['terminated', 'منتهي الخدمة']]
    .map(([v, l]) => `<option value="${v}" ${e.status === v ? 'selected' : ''}>${l}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label>رصيد الإجازة السنوية (يوم)</label>
              <input type="number" name="annual_leave_balance" step="0.5" min="0"
                     value="${e.annual_leave_balance !== undefined ? e.annual_leave_balance : 30}">
            </div>
            <div class="field">
              <label>رقم رخصة القيادة</label>
              <input type="text" name="license_no" value="${ui.esc(e.license_no || '')}" dir="ltr">
            </div>
            <div class="field">
              <label>انتهاء رخصة القيادة</label>
              <input type="date" name="license_expiry" value="${ui.esc((e.license_expiry || '').slice(0, 10))}">
            </div>
          </div>
        </div>

        <div data-panel="salary" class="hidden">
          <div class="form-grid">
            <div class="field">
              <label>الراتب الأساسي (ر.س)</label>
              <input type="number" name="basic_salary" step="0.01" min="0" value="${e.basic_salary || 0}">
            </div>
            <div class="field">
              <label>بدل السكن (ر.س)</label>
              <input type="number" name="housing_allowance" step="0.01" min="0" value="${e.housing_allowance || 0}">
            </div>
            <div class="field">
              <label>بدل النقل (ر.س)</label>
              <input type="number" name="transport_allowance" step="0.01" min="0" value="${e.transport_allowance || 0}">
            </div>
            <div class="field">
              <label>بدلات أخرى (ر.س)</label>
              <input type="number" name="other_allowance" step="0.01" min="0" value="${e.other_allowance || 0}">
            </div>
            <div class="field">
              <label>اسم البنك</label>
              <input type="text" name="bank_name" value="${ui.esc(e.bank_name || '')}">
            </div>
            <div class="field">
              <label>رقم الآيبان</label>
              <input type="text" name="iban" value="${ui.esc(e.iban || '')}" dir="ltr" placeholder="SA00 0000 0000 0000 0000 0000">
            </div>
          </div>
        </div>

        <div data-panel="personal" class="hidden">
          <div class="form-grid">
            <div class="field">
              <label>الجنسية</label>
              <input type="text" name="nationality" list="nationalities" value="${ui.esc(e.nationality || '')}">
              <datalist id="nationalities">
                ${NATIONALITIES.map((n) => `<option value="${ui.esc(n)}"></option>`).join('')}
              </datalist>
              <div class="hint">تحدّد فئة التأمينات: «سعودي» ⇽ 22%، وغيرها ⇽ 2% أخطار مهنية على الشركة.</div>
            </div>
            <div class="field">
              <label>الجنس</label>
              <select name="gender">
                <option value="">— اختر —</option>
                <option value="ذكر" ${e.gender === 'ذكر' ? 'selected' : ''}>ذكر</option>
                <option value="أنثى" ${e.gender === 'أنثى' ? 'selected' : ''}>أنثى</option>
              </select>
            </div>
            <div class="field">
              <label>تاريخ الميلاد</label>
              <input type="date" name="birth_date" value="${ui.esc((e.birth_date || '').slice(0, 10))}">
            </div>
            <div class="field">
              <label>انتهاء الإقامة</label>
              <input type="date" name="iqama_expiry" value="${ui.esc((e.iqama_expiry || '').slice(0, 10))}">
            </div>
            <div class="field full">
              <label>العنوان</label>
              <input type="text" name="address" value="${ui.esc(e.address || '')}">
            </div>
            <div class="field">
              <label>جهة الاتصال للطوارئ</label>
              <input type="text" name="emergency_contact" value="${ui.esc(e.emergency_contact || '')}">
            </div>
            <div class="field">
              <label>جوال الطوارئ</label>
              <input type="text" name="emergency_phone" value="${ui.esc(e.emergency_phone || '')}" dir="ltr">
            </div>
          </div>
        </div>
      </form>`;
  }

  function bindTabs(root) {
    const tabs = root.querySelector('#form-tabs');
    if (!tabs) return;
    tabs.addEventListener('click', (event) => {
      const button = event.target.closest('[data-tab]');
      if (!button) return;
      tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === button));
      root.querySelectorAll('[data-panel]').forEach((panel) => {
        panel.classList.toggle('hidden', panel.dataset.panel !== button.dataset.tab);
      });
    });
  }

  async function openForm(employee, App) {
    const modal = ui.modal(employee ? `تعديل بيانات: ${employee.full_name_ar}` : 'إضافة موظف جديد',
      formHtml(employee, App), {
        wide: true,
        footer: `<button class="btn" form="employee-form" type="submit">${employee ? 'حفظ التعديلات' : 'إنشاء الحساب'}</button>
                 ${employee && App.hasRole('admin', 'hr') ? '<button class="btn secondary" id="reset-pw" type="button">إعادة تعيين كلمة المرور</button>' : ''}`,
      });

    bindTabs(modal.el);

    const resetButton = modal.el.querySelector('#reset-pw');
    if (resetButton) {
      resetButton.addEventListener('click', async () => {
        const ok = await ui.confirm('إعادة تعيين كلمة المرور',
          `سيتم إنشاء كلمة مرور مؤقتة لـ ${employee.full_name_ar} ويُطلب منه تغييرها عند أول دخول.`,
          'إعادة التعيين', 'accent');
        if (!ok) return;
        try {
          const result = await api.post(`/employees/${employee.id}/reset-password`);
          ui.modal('كلمة المرور المؤقتة', `
            <p>${ui.esc(result.message)}</p>
            <div class="field"><input type="text" value="${ui.esc(result.temp_password)}" readonly dir="ltr"></div>
            <p class="small muted mb-0">انسخ كلمة المرور وسلّمها للموظف عبر قناة آمنة — لن تظهر مرة أخرى.</p>`,
          { footer: null });
        } catch (error) { ui.fail(error); }
      });
    }

    modal.el.querySelector('#employee-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = ui.formData(event.target);
      try {
        const result = employee
          ? await api.put(`/employees/${employee.id}`, data)
          : await api.post('/employees', data);
        modal.close();
        ui.toast(result.message || 'تم الحفظ', 'success');

        if (result.temp_password) {
          ui.modal('تم إنشاء الحساب', `
            <p>كلمة المرور المؤقتة للموظف:</p>
            <div class="field"><input type="text" value="${ui.esc(result.temp_password)}" readonly dir="ltr"></div>
            <p class="small muted mb-0">سلّمها للموظف عبر قناة آمنة — سيُطلب منه تغييرها عند أول تسجيل دخول.</p>`,
          { footer: null });
        }
        App.refresh();
      } catch (error) { ui.fail(error); }
    });
  }

  global.PAGES.employees = {
    async render(container, App) {
      const filters = {
        q: App.params.q || '',
        department_id: App.params.department_id || '',
        status: App.params.status || 'active',
        role: App.params.role || '',
        page: Number(App.params.page) || 1,
      };

      const [list, deptResult, lookup] = await Promise.all([
        api.get(`/employees${api.qs({ ...filters, limit: 25 })}`),
        api.get('/departments'),
        api.get('/employees/lookup'),
      ]);

      departments = deptResult.data;
      managers = lookup.data;

      const canManage = App.hasRole('admin', 'hr');
      const canSeeSalary = App.hasRole('admin', 'hr', 'finance');
      const p = list.pagination;

      const columns = [
        { title: 'الرقم', key: 'employee_no', cls: 'num' },
        { title: 'الاسم', render: (r) => `<a href="#/profile?id=${r.id}">${ui.esc(r.full_name_ar)}</a>` },
        { title: 'المسمى الوظيفي', key: 'job_title' },
        { title: 'القسم', key: 'department_name' },
        { title: 'المدير المباشر', key: 'manager_name' },
        { title: 'الجوال', render: (r) => `<span dir="ltr">${ui.esc(r.phone || '')}</span>` },
        { title: 'تاريخ التعيين', render: (r) => ui.dateShort(r.hire_date) },
        { title: 'الدور', render: (r) => `<span class="badge neutral">${ui.role(r.role)}</span>` },
        { title: 'الحالة', render: (r) => ui.status(r.status) },
      ];

      if (canSeeSalary) {
        columns.splice(7, 0, {
          title: 'إجمالي الاستحقاق',
          cls: 'num',
          render: (r) => ui.money((r.basic_salary || 0) + (r.housing_allowance || 0)
            + (r.transport_allowance || 0) + (r.other_allowance || 0)),
        });
      }

      if (canManage) {
        columns.push({
          title: 'إجراءات',
          render: (r) => `
            <div class="btn-row">
              <button class="btn sm secondary" data-edit="${r.id}">تعديل</button>
              ${r.status !== 'terminated' ? `<button class="btn sm danger" data-terminate="${r.id}">إنهاء خدمة</button>` : ''}
            </div>`,
        });
      }

      container.innerHTML = `
        <div class="filters">
          <div class="field">
            <label>بحث</label>
            <input type="search" id="f-q" value="${ui.esc(filters.q)}" placeholder="الاسم، الرقم الوظيفي، البريد…">
          </div>
          <div class="field">
            <label>القسم</label>
            <select id="f-dept"><option value="">كل الأقسام</option>${ui.options(departments, 'id', 'name_ar', filters.department_id)}</select>
          </div>
          <div class="field">
            <label>الحالة</label>
            <select id="f-status">
              <option value="">الكل</option>
              <option value="active"     ${filters.status === 'active' ? 'selected' : ''}>على رأس العمل</option>
              <option value="suspended"  ${filters.status === 'suspended' ? 'selected' : ''}>موقوف</option>
              <option value="terminated" ${filters.status === 'terminated' ? 'selected' : ''}>منتهي الخدمة</option>
            </select>
          </div>
          <div class="field">
            <label>الدور</label>
            <select id="f-role">
              <option value="">الكل</option>
              ${ROLES.map(([v, l]) => `<option value="${v}" ${filters.role === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          <button class="btn" id="apply">تصفية</button>
          ${canManage ? '<button class="btn accent" id="add">+ موظف جديد</button>' : ''}
        </div>

        <div class="card">
          <div class="card-head">
            <h3>قائمة الموظفين</h3>
            <div class="spacer"></div>
            <span class="muted small">${ui.number(p.total)} موظف — صفحة ${ui.number(p.page)} من ${ui.number(p.pages)}</span>
          </div>
          <div class="card-body tight">${ui.table(columns, list.data, 'لا يوجد موظفون مطابقون للبحث')}</div>
          ${p.pages > 1 ? `
            <div class="card-body flex" style="justify-content:center">
              <button class="btn secondary sm" id="prev" ${p.page <= 1 ? 'disabled' : ''}>السابق</button>
              <span class="small muted">${ui.number(p.page)} / ${ui.number(p.pages)}</span>
              <button class="btn secondary sm" id="next" ${p.page >= p.pages ? 'disabled' : ''}>التالي</button>
            </div>` : ''}
        </div>`;

      const applyFilters = (extra) => App.go('employees', {
        q: container.querySelector('#f-q').value,
        department_id: container.querySelector('#f-dept').value,
        status: container.querySelector('#f-status').value,
        role: container.querySelector('#f-role').value,
        page: 1,
        ...extra,
      });

      container.querySelector('#apply').addEventListener('click', () => applyFilters());
      container.querySelector('#f-q').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') applyFilters();
      });
      ['#f-dept', '#f-status', '#f-role'].forEach((selector) => {
        container.querySelector(selector).addEventListener('change', () => applyFilters());
      });

      const prev = container.querySelector('#prev');
      const next = container.querySelector('#next');
      if (prev) prev.addEventListener('click', () => applyFilters({ page: p.page - 1 }));
      if (next) next.addEventListener('click', () => applyFilters({ page: p.page + 1 }));

      const add = container.querySelector('#add');
      if (add) add.addEventListener('click', () => openForm(null, App));

      container.querySelectorAll('[data-edit]').forEach((button) => {
        button.addEventListener('click', async () => {
          const result = await api.get(`/employees/${button.dataset.edit}`);
          openForm(result.data, App);
        });
      });

      container.querySelectorAll('[data-terminate]').forEach((button) => {
        button.addEventListener('click', async () => {
          const ok = await ui.confirm('إنهاء خدمة الموظف',
            'سيتم تعطيل الحساب ونقل الموظف إلى حالة "منتهي الخدمة". يمكن التراجع بتعديل حالته لاحقاً.',
            'إنهاء الخدمة');
          if (!ok) return;
          try {
            const result = await api.del(`/employees/${button.dataset.terminate}`);
            ui.toast(result.message, 'success');
            App.refresh();
          } catch (error) { ui.fail(error); }
        });
      });

      // فتح نموذج التعديل مباشرة عند الوصول من صفحة الملف الشخصي
      if (App.params.edit && canManage) {
        const result = await api.get(`/employees/${App.params.edit}`);
        openForm(result.data, App);
      }
    },
  };
}(window));
