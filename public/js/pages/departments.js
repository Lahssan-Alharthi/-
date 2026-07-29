/* الأقسام والهيكل التنظيمي */
(function registerDepartments(global) {
  'use strict';

  global.PAGES = global.PAGES || {};

  function orgNode(node, root) {
    return `
      <div class="org-node ${root ? 'root' : ''}">
        <div class="org-card">
          <div class="avatar">${ui.initials(node.full_name_ar)}</div>
          <div>
            <div><a href="#/profile?id=${node.id}">${ui.esc(node.full_name_ar)}</a></div>
            <div class="t">${ui.esc(node.job_title || '')}${node.department_name ? ` — ${ui.esc(node.department_name)}` : ''}</div>
          </div>
        </div>
        ${node.reports && node.reports.length ? node.reports.map((child) => orgNode(child, false)).join('') : ''}
      </div>`;
  }

  function openForm(department, employees, App) {
    const d = department || {};
    const modal = ui.modal(department ? `تعديل القسم: ${d.name_ar}` : 'إضافة قسم جديد', `
      <form id="dept-form">
        <div class="form-grid">
          <div class="field">
            <label>رمز القسم *</label>
            <input type="text" name="code" required value="${ui.esc(d.code || '')}" dir="ltr" placeholder="OPS">
          </div>
          <div class="field">
            <label>الاسم بالعربية *</label>
            <input type="text" name="name_ar" required value="${ui.esc(d.name_ar || '')}">
          </div>
          <div class="field">
            <label>الاسم بالإنجليزية</label>
            <input type="text" name="name_en" value="${ui.esc(d.name_en || '')}" dir="ltr">
          </div>
          <div class="field">
            <label>مركز التكلفة</label>
            <input type="text" name="cost_center" value="${ui.esc(d.cost_center || '')}" dir="ltr">
          </div>
          <div class="field full">
            <label>مدير القسم</label>
            <select name="manager_id">
              <option value="">— بدون —</option>
              ${ui.options(employees, 'id', 'full_name_ar', d.manager_id)}
            </select>
          </div>
          <div class="field full">
            <label>الوصف</label>
            <textarea name="description">${ui.esc(d.description || '')}</textarea>
          </div>
        </div>
      </form>`, {
      footer: '<button class="btn" form="dept-form" type="submit">حفظ</button>',
    });

    modal.el.querySelector('#dept-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const data = ui.formData(event.target);
        const result = department
          ? await api.put(`/departments/${department.id}`, data)
          : await api.post('/departments', data);
        modal.close();
        ui.toast(result.message, 'success');
        App.refresh();
      } catch (error) { ui.fail(error); }
    });
  }

  global.PAGES.departments = {
    async render(container, App) {
      const [deptResult, orgResult, lookup] = await Promise.all([
        api.get('/departments'),
        api.get('/employees/org-chart'),
        api.get('/employees/lookup'),
      ]);

      const departments = deptResult.data;
      const canManage = App.hasRole('admin', 'hr');
      const total = departments.reduce((sum, d) => sum + d.employees_count, 0);

      const columns = [
        { title: 'الرمز', key: 'code' },
        { title: 'القسم', key: 'name_ar' },
        { title: 'بالإنجليزية', key: 'name_en' },
        { title: 'مدير القسم', render: (r) => (r.manager_name ? ui.esc(r.manager_name) : '<span class="muted">غير محدد</span>') },
        { title: 'مركز التكلفة', key: 'cost_center' },
        { title: 'عدد الموظفين', cls: 'num', render: (r) => ui.number(r.employees_count) },
      ];

      if (canManage) {
        columns.push({
          title: 'إجراءات',
          render: (r) => `
            <div class="btn-row">
              <button class="btn sm secondary" data-edit="${r.id}">تعديل</button>
              <button class="btn sm danger" data-del="${r.id}">حذف</button>
            </div>`,
        });
      }

      container.innerHTML = `
        <div class="grid grid-4 mb-2">
          ${ui.stat('🏢', 'عدد الأقسام', ui.number(departments.length), 'الهيكل التنظيمي')}
          ${ui.stat('👥', 'إجمالي الموظفين', ui.number(total), 'على رأس العمل', 'ok')}
          ${ui.stat('📊', 'متوسط حجم القسم', ui.number(Math.round(total / (departments.length || 1))), 'موظف لكل قسم', 'info')}
          ${ui.stat('👔', 'أقسام بلا مدير', ui.number(departments.filter((d) => !d.manager_id).length), 'تحتاج تعيين مدير', 'warn')}
        </div>

        <div class="card">
          <div class="card-head">
            <h3>الأقسام</h3><div class="spacer"></div>
            ${canManage ? '<button class="btn accent" id="add">+ قسم جديد</button>' : ''}
          </div>
          <div class="card-body tight">${ui.table(columns, departments, 'لا توجد أقسام')}</div>
        </div>

        <div class="grid grid-2">
          <div class="card">
            <div class="card-head"><h3>توزيع الموظفين</h3></div>
            <div class="card-body">
              ${ui.bars(departments.map((d) => ({ label: d.name_ar, value: d.employees_count })))}
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h3>الهيكل التنظيمي</h3></div>
            <div class="card-body" style="max-height:520px;overflow:auto">
              ${orgResult.data.length ? orgResult.data.map((n) => orgNode(n, true)).join('') : ui.empty('لا توجد بيانات')}
            </div>
          </div>
        </div>`;

      const add = container.querySelector('#add');
      if (add) add.addEventListener('click', () => openForm(null, lookup.data, App));

      container.querySelectorAll('[data-edit]').forEach((button) => {
        button.addEventListener('click', () => {
          const department = departments.find((d) => String(d.id) === button.dataset.edit);
          openForm(department, lookup.data, App);
        });
      });

      container.querySelectorAll('[data-del]').forEach((button) => {
        button.addEventListener('click', async () => {
          const ok = await ui.confirm('حذف القسم', 'سيتم حذف القسم نهائياً. لا يمكن حذف قسم يرتبط به موظفون.', 'حذف');
          if (!ok) return;
          try {
            const result = await api.del(`/departments/${button.dataset.del}`);
            ui.toast(result.message, 'success');
            App.refresh();
          } catch (error) { ui.fail(error); }
        });
      });
    },
  };
}(window));
