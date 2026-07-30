/* الحضور والانصراف */
(function registerAttendance(global) {
  'use strict';

  global.PAGES = global.PAGES || {};

  const STATUS_OPTIONS = [
    ['present', 'حاضر'], ['late', 'متأخر'], ['absent', 'غائب'], ['leave', 'إجازة'],
    ['remote', 'عن بُعد'], ['mission', 'مهمة عمل'], ['holiday', 'عطلة'],
  ];

  function manualDialog(employees, App) {
    const modal = ui.modal('إدخال سجل حضور يدوي', `
      <form id="att-form">
        <div class="form-grid">
          <div class="field">
            <label>الموظف *</label>
            <select name="employee_id" required>
              <option value="">— اختر الموظف —</option>
              ${ui.options(employees, 'id', 'full_name_ar')}
            </select>
          </div>
          <div class="field">
            <label>التاريخ *</label>
            <input type="date" name="date" required value="${new Date().toISOString().slice(0, 10)}">
          </div>
          <div class="field">
            <label>وقت الحضور</label>
            <input type="time" name="check_in">
          </div>
          <div class="field">
            <label>وقت الانصراف</label>
            <input type="time" name="check_out">
          </div>
          <div class="field">
            <label>الحالة</label>
            <select name="status">
              ${STATUS_OPTIONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
            </select>
          </div>
          <div class="field full">
            <label>ملاحظات</label>
            <input type="text" name="notes" placeholder="سبب التعديل اليدوي">
          </div>
        </div>
      </form>`, {
      footer: '<button class="btn" form="att-form" type="submit">حفظ السجل</button>',
    });

    modal.el.querySelector('#att-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const result = await api.post('/attendance', ui.formData(event.target));
        modal.close();
        ui.toast(result.message, 'success');
        App.refresh();
      } catch (error) { ui.fail(error); }
    });
  }

  global.PAGES.attendance = {
    async render(container, App) {
      const canManage = App.hasRole('admin', 'hr');
      const isPrivileged = App.hasRole('admin', 'hr', 'finance', 'operations', 'manager');

      const now = new Date();
      const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const filters = {
        from: App.params.from || defaultFrom,
        to: App.params.to || now.toISOString().slice(0, 10),
        employee_id: App.params.employee_id || '',
        status: App.params.status || '',
        department_id: App.params.department_id || '',
      };

      const requests = [
        api.get('/attendance/today'),
        api.get(`/attendance${api.qs({ ...filters, limit: 400 })}`),
        api.get(`/attendance/summary/${filters.employee_id || App.user.id}`),
      ];
      if (isPrivileged) {
        requests.push(api.get('/employees/lookup'), api.get('/departments'));
      }

      const [todayResult, listResult, summaryResult, lookupResult, deptResult] = await Promise.all(requests);

      const state = todayResult.data;
      const summary = summaryResult.data;
      const employees = lookupResult ? lookupResult.data : [];
      const departments = deptResult ? deptResult.data : [];

      const columns = [
        { title: 'التاريخ', render: (r) => ui.dateShort(r.date) },
        ...(isPrivileged ? [
          { title: 'الموظف', render: (r) => `<a href="#/profile?id=${r.employee_id}">${ui.esc(r.employee_name)}</a>` },
          { title: 'القسم', key: 'department_name' },
        ] : []),
        { title: 'الحضور', render: (r) => ui.time(r.check_in) },
        { title: 'الانصراف', render: (r) => ui.time(r.check_out) },
        { title: 'مدة العمل', render: (r) => (r.work_minutes ? ui.duration(r.work_minutes) : '—') },
        { title: 'التأخير', render: (r) => (r.late_minutes ? `<span class="badge warn">${r.late_minutes} د</span>` : '—') },
        { title: 'إضافي', render: (r) => (r.overtime_minutes ? ui.duration(r.overtime_minutes) : '—') },
        { title: 'الحالة', render: (r) => ui.status(r.status) },
        { title: 'المصدر', render: (r) => `<span class="small muted">${r.source === 'manual' ? 'إدخال يدوي' : (r.source === 'system' ? 'النظام' : 'البوابة')}</span>` },
      ];

      if (canManage) {
        columns.push({
          title: '',
          render: (r) => `<button class="btn sm danger" data-del="${r.id}">حذف</button>`,
        });
      }

      const attendanceRate = summary.working_days
        ? ((summary.present_days || 0) + (summary.late_days || 0)) / summary.working_days * 100
        : 0;

      container.innerHTML = `
        <div class="card">
          <div class="card-body flex flex-wrap">
            <div>
              <div class="muted small">اليوم — ${ui.date(state.date)}</div>
              <h2 class="mb-0">
                ${state.record && state.record.check_in
    ? `حضور ${ui.time(state.record.check_in)}${state.record.check_out ? ` — انصراف ${ui.time(state.record.check_out)}` : ''}`
    : 'لم تسجّل حضورك بعد'}
              </h2>
              <div class="muted small">الدوام الرسمي ${state.policy.startTime} — ${state.policy.endTime}
                (فترة سماح ${state.policy.graceMinutes} دقيقة)</div>
            </div>
            <div class="spacer"></div>
            <div class="btn-row">
              ${state.is_weekend ? '<span class="badge neutral">عطلة نهاية الأسبوع</span>' : `
                <button class="btn" id="check-in" ${state.can_check_in ? '' : 'disabled'}>تسجيل حضور</button>
                <button class="btn accent" id="check-out" ${state.can_check_out ? '' : 'disabled'}>تسجيل انصراف</button>`}
              ${canManage ? '<button class="btn secondary" id="manual">إدخال يدوي</button>' : ''}
            </div>
          </div>
        </div>

        <div class="grid grid-4 mb-2">
          ${ui.stat('✅', 'أيام الحضور', ui.number((summary.present_days || 0) + (summary.late_days || 0)),
    `من ${ui.number(summary.working_days)} يوم عمل`, 'ok')}
          ${ui.stat('⏰', 'أيام التأخير', ui.number(summary.late_days || 0),
    `${ui.number(summary.late_minutes || 0)} دقيقة إجمالاً`, 'warn')}
          ${ui.stat('❌', 'أيام الغياب', ui.number(summary.absent_days || 0), 'خلال الشهر', 'danger')}
          ${ui.stat('🕐', 'ساعات العمل', ui.duration(summary.work_minutes || 0),
    `إضافي ${ui.duration(summary.overtime_minutes || 0)}`, 'info')}
        </div>

        <div class="card">
          <div class="card-body">
            ${ui.ring(attendanceRate, 'نسبة الالتزام بالدوام هذا الشهر',
    `${ui.number((summary.present_days || 0) + (summary.late_days || 0))} يوم حضور من ${ui.number(summary.working_days)}`)}
          </div>
        </div>

        <div class="filters">
          <div class="field"><label>من تاريخ</label><input type="date" id="f-from" value="${filters.from}"></div>
          <div class="field"><label>إلى تاريخ</label><input type="date" id="f-to" value="${filters.to}"></div>
          ${isPrivileged ? `
            <div class="field">
              <label>الموظف</label>
              <select id="f-emp"><option value="">كل الموظفين</option>${ui.options(employees, 'id', 'full_name_ar', filters.employee_id)}</select>
            </div>
            <div class="field">
              <label>القسم</label>
              <select id="f-dept"><option value="">كل الأقسام</option>${ui.options(departments, 'id', 'name_ar', filters.department_id)}</select>
            </div>` : ''}
          <div class="field">
            <label>الحالة</label>
            <select id="f-status">
              <option value="">الكل</option>
              ${STATUS_OPTIONS.map(([v, l]) => `<option value="${v}" ${filters.status === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          <button class="btn" id="apply">تصفية</button>
        </div>

        <div class="card">
          <div class="card-head">
            <h3>سجل الحضور</h3><div class="spacer"></div>
            <span class="muted small">${ui.number(listResult.data.length)} سجل</span>
          </div>
          <div class="card-body tight">${ui.table(columns, listResult.data, 'لا توجد سجلات في الفترة المحددة')}</div>
        </div>`;

      const bindCheck = (selector, path) => {
        const button = container.querySelector(selector);
        if (!button) return;
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const result = await pwa.markAttendance(path);
            ui.toast(result.message, result.queued ? 'warn' : 'success');
            if (!result.queued) App.refresh();
          } catch (error) { ui.fail(error); button.disabled = false; }
        });
      };
      bindCheck('#check-in', '/attendance/check-in');
      bindCheck('#check-out', '/attendance/check-out');

      const manual = container.querySelector('#manual');
      if (manual) manual.addEventListener('click', () => manualDialog(employees, App));

      container.querySelector('#apply').addEventListener('click', () => {
        App.go('attendance', {
          from: container.querySelector('#f-from').value,
          to: container.querySelector('#f-to').value,
          employee_id: isPrivileged ? container.querySelector('#f-emp').value : '',
          department_id: isPrivileged ? container.querySelector('#f-dept').value : '',
          status: container.querySelector('#f-status').value,
        });
      });

      container.querySelectorAll('[data-del]').forEach((button) => {
        button.addEventListener('click', async () => {
          const ok = await ui.confirm('حذف السجل', 'سيتم حذف سجل الحضور نهائياً.', 'حذف');
          if (!ok) return;
          try {
            await api.del(`/attendance/${button.dataset.del}`);
            ui.toast('تم حذف السجل', 'success');
            App.refresh();
          } catch (error) { ui.fail(error); }
        });
      });
    },
  };
}(window));
