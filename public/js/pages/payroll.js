/* الرواتب وإشعارات الراتب */
(function registerPayroll(global) {
  'use strict';

  global.PAGES = global.PAGES || {};

  function payslipHtml(slip) {
    const deductions = (slip.gosi_deduction || 0) + (slip.absence_deduction || 0)
      + (slip.loan_deduction || 0) + (slip.other_deduction || 0);

    const line = (label, value, negative) => `
      <div class="row">
        <span class="k">${label}</span>
        <span class="v money" style="${negative ? 'color:var(--danger)' : ''}">${negative ? '−' : ''}${ui.money(value)}</span>
      </div>`;

    return `
      <div class="payslip">
        <div class="payslip-head">
          <div>
            <div style="font-size:1.15rem;font-weight:700">إشعار راتب — ${slip.month_name} ${slip.year}</div>
            <div style="opacity:.85;font-size:.85rem">شركة مدد للخدمات اللوجستية</div>
          </div>
          <div class="text-end">
            <div>${ui.esc(slip.employee_name)}</div>
            <div style="opacity:.85;font-size:.85rem">${ui.esc(slip.job_title || '')} — ${ui.esc(slip.employee_no)}</div>
          </div>
        </div>

        <div class="payslip-body">
          <div class="grid grid-2">
            <div>
              <h3>الاستحقاقات</h3>
              <div class="info-list" style="grid-template-columns:1fr">
                ${line('الراتب الأساسي', slip.basic_salary)}
                ${line('بدل السكن', slip.housing_allowance)}
                ${line('بدل النقل', slip.transport_allowance)}
                ${line('بدلات أخرى', slip.other_allowance)}
                ${line(`الوقت الإضافي (${ui.number(slip.overtime_hours)} ساعة)`, slip.overtime_amount)}
                <div class="row"><span class="k"><b>إجمالي الاستحقاق</b></span>
                  <span class="v money">${ui.money(slip.gross_amount)}</span></div>
              </div>
            </div>

            <div>
              <h3>الاستقطاعات</h3>
              <div class="info-list" style="grid-template-columns:1fr">
                ${line('التأمينات الاجتماعية (9.75%)', slip.gosi_deduction, true)}
                ${line(`الغياب (${ui.number(slip.absent_days)} يوم)`, slip.absence_deduction, true)}
                ${line('السلف', slip.loan_deduction, true)}
                ${line('استقطاعات أخرى', slip.other_deduction, true)}
                <div class="row"><span class="k"><b>إجمالي الاستقطاعات</b></span>
                  <span class="v money" style="color:var(--danger)">−${ui.money(deductions)}</span></div>
              </div>
            </div>
          </div>

          ${slip.iban ? `<p class="small muted mt-2 mb-0">يُحوَّل المبلغ إلى ${ui.esc(slip.bank_name || '')} — <span dir="ltr">${ui.esc(slip.iban)}</span></p>` : ''}
        </div>

        <div class="payslip-total">
          <span>صافي الراتب المستحق</span>
          <span class="money">${ui.money(slip.net_amount)}</span>
        </div>
      </div>`;
  }

  async function showPayslip(id) {
    const result = await api.get(`/payroll/payslips/${id}`);
    ui.modal('إشعار الراتب', payslipHtml(result.data), {
      wide: true,
      footer: '<button class="btn secondary" onclick="window.print()">طباعة</button>',
    });
  }

  function generateDialog(App) {
    const now = new Date();
    const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const modal = ui.modal('توليد مسيّر رواتب', `
      <form id="run-form">
        <p class="small muted">يحسب النظام لكل موظف نشط: الراتب الأساسي والبدلات والوقت الإضافي،
          مطروحاً منها التأمينات الاجتماعية وخصم الغياب والسلف المعتمدة خلال الشهر.</p>
        <div class="form-grid">
          <div class="field">
            <label>السنة *</label>
            <input type="number" name="year" required min="2000" max="2100" value="${previous.getFullYear()}">
          </div>
          <div class="field">
            <label>الشهر *</label>
            <select name="month" required>
              ${ui.ARABIC_MONTHS.map((m, i) => `<option value="${i + 1}" ${i === previous.getMonth() ? 'selected' : ''}>${m}</option>`).join('')}
            </select>
          </div>
          <div class="field full">
            <label>ملاحظات</label>
            <input type="text" name="notes">
          </div>
        </div>
      </form>`, {
      footer: '<button class="btn" form="run-form" type="submit">توليد المسيّر</button>',
    });

    modal.el.querySelector('#run-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const result = await api.post('/payroll/runs', ui.formData(event.target));
        modal.close();
        ui.toast(result.message, 'success');
        App.refresh();
      } catch (error) { ui.fail(error); }
    });
  }

  async function showRun(runId, App) {
    const result = await api.get(`/payroll/runs/${runId}`);
    const run = result.data;

    const modal = ui.modal(`مسيّر رواتب ${run.month_name} ${run.year}`, `
      <div class="grid grid-3 mb-2">
        ${ui.stat('👥', 'عدد الموظفين', ui.number(run.payslips.length), '')}
        ${ui.stat('💰', 'إجمالي الاستحقاق', ui.money(run.total_gross), '', 'info')}
        ${ui.stat('✅', 'صافي المستحق', ui.money(run.total_net), ui.statusText(run.status), 'ok')}
      </div>
      ${ui.table([
    { title: 'الرقم', key: 'employee_no' },
    { title: 'الموظف', key: 'employee_name' },
    { title: 'القسم', key: 'department_name' },
    { title: 'الأساسي', cls: 'num', render: (r) => ui.money(r.basic_salary) },
    { title: 'البدلات', cls: 'num', render: (r) => ui.money((r.housing_allowance || 0) + (r.transport_allowance || 0) + (r.other_allowance || 0)) },
    { title: 'إضافي', cls: 'num', render: (r) => ui.money(r.overtime_amount) },
    { title: 'الاستقطاعات', cls: 'num', render: (r) => ui.money((r.gosi_deduction || 0) + (r.absence_deduction || 0) + (r.loan_deduction || 0) + (r.other_deduction || 0)) },
    { title: 'الصافي', cls: 'num', render: (r) => `<b class="money">${ui.money(r.net_amount)}</b>` },
    { title: '', render: (r) => `<button class="btn sm secondary" data-slip="${r.id}">عرض</button>` },
  ], run.payslips, 'لا توجد إشعارات رواتب')}`, {
      wide: true,
      footer: run.status === 'draft' && App.hasRole('admin', 'finance')
        ? '<button class="btn" id="approve-run">اعتماد المسيّر وإشعار الموظفين</button>'
        : '<span class="badge ok">مسيّر معتمد</span>',
    });

    modal.el.querySelectorAll('[data-slip]').forEach((button) => {
      button.addEventListener('click', () => showPayslip(button.dataset.slip));
    });

    const approve = modal.el.querySelector('#approve-run');
    if (approve) {
      approve.addEventListener('click', async () => {
        const ok = await ui.confirm('اعتماد المسيّر',
          'بعد الاعتماد تصبح إشعارات الرواتب مرئية للموظفين ولا يمكن حذف المسيّر.', 'اعتماد', 'accent');
        if (!ok) return;
        try {
          const response = await api.post(`/payroll/runs/${runId}/approve`);
          modal.close();
          ui.toast(response.message, 'success');
          App.refresh();
        } catch (error) { ui.fail(error); }
      });
    }
  }

  global.PAGES.payroll = {
    async render(container, App) {
      const canManage = App.hasRole('admin', 'finance');
      const canView = App.hasRole('admin', 'finance', 'hr');

      const requests = [api.get('/payroll/my-payslips')];
      if (canView) requests.push(api.get('/payroll/runs'));

      const [mine, runsResult] = await Promise.all(requests);
      const runs = runsResult ? runsResult.data : [];

      const latest = mine.data[0];

      container.innerHTML = `
        ${latest ? `
          <div class="grid grid-4 mb-2">
            ${ui.stat('💰', 'آخر صافي راتب', ui.money(latest.net_amount), `${latest.month_name} ${latest.year}`, 'ok')}
            ${ui.stat('📈', 'إجمالي الاستحقاق', ui.money(latest.gross_amount), 'قبل الاستقطاعات', 'info')}
            ${ui.stat('📉', 'الاستقطاعات', ui.money((latest.gosi_deduction || 0) + (latest.absence_deduction || 0) + (latest.loan_deduction || 0) + (latest.other_deduction || 0)), 'تأمينات وغياب وسلف', 'warn')}
            ${ui.stat('🧾', 'إشعارات الراتب', ui.number(mine.data.length), 'متاحة للاطلاع', 'accent')}
          </div>` : ''}

        <div class="card">
          <div class="card-head"><h3>إشعارات راتبي</h3></div>
          <div class="card-body tight">
            ${ui.table([
    { title: 'الشهر', render: (r) => `${r.month_name} ${r.year}` },
    { title: 'الأساسي', cls: 'num', render: (r) => ui.money(r.basic_salary) },
    { title: 'البدلات', cls: 'num', render: (r) => ui.money((r.housing_allowance || 0) + (r.transport_allowance || 0) + (r.other_allowance || 0)) },
    { title: 'إضافي', cls: 'num', render: (r) => ui.money(r.overtime_amount) },
    { title: 'الاستقطاعات', cls: 'num', render: (r) => ui.money((r.gosi_deduction || 0) + (r.absence_deduction || 0) + (r.loan_deduction || 0) + (r.other_deduction || 0)) },
    { title: 'الصافي', cls: 'num', render: (r) => `<b class="money">${ui.money(r.net_amount)}</b>` },
    { title: '', render: (r) => `<button class="btn sm secondary" data-slip="${r.id}">عرض الإشعار</button>` },
  ], mine.data, 'لا توجد إشعارات رواتب معتمدة بعد')}
          </div>
        </div>

        ${canView ? `
          <div class="card">
            <div class="card-head">
              <h3>مسيّرات الرواتب</h3><div class="spacer"></div>
              ${canManage ? '<button class="btn accent" id="new-run">+ توليد مسيّر</button>' : ''}
            </div>
            <div class="card-body tight">
              ${ui.table([
    { title: 'الفترة', render: (r) => `${r.month_name} ${r.year}` },
    { title: 'عدد الموظفين', cls: 'num', render: (r) => ui.number(r.employees_count) },
    { title: 'إجمالي الاستحقاق', cls: 'num', render: (r) => ui.money(r.total_gross) },
    { title: 'صافي المستحق', cls: 'num', render: (r) => `<b class="money">${ui.money(r.total_net)}</b>` },
    { title: 'الحالة', render: (r) => ui.status(r.status) },
    { title: 'أنشأه', key: 'created_by_name' },
    { title: 'اعتمده', key: 'approved_by_name' },
    {
      title: 'إجراءات',
      render: (r) => `<div class="btn-row">
                        <button class="btn sm secondary" data-run="${r.id}">التفاصيل</button>
                        ${r.status === 'draft' && canManage ? `<button class="btn sm danger" data-del-run="${r.id}">حذف</button>` : ''}
                      </div>`,
    },
  ], runs, 'لا توجد مسيّرات رواتب')}
            </div>
          </div>` : ''}`;

      container.querySelectorAll('[data-slip]').forEach((button) => {
        button.addEventListener('click', () => showPayslip(button.dataset.slip).catch(ui.fail));
      });

      container.querySelectorAll('[data-run]').forEach((button) => {
        button.addEventListener('click', () => showRun(button.dataset.run, App).catch(ui.fail));
      });

      container.querySelectorAll('[data-del-run]').forEach((button) => {
        button.addEventListener('click', async () => {
          const ok = await ui.confirm('حذف المسيّر', 'سيتم حذف المسيّر وكل إشعارات الرواتب المرتبطة به.', 'حذف');
          if (!ok) return;
          try {
            const result = await api.del(`/payroll/runs/${button.dataset.delRun}`);
            ui.toast(result.message, 'success');
            App.refresh();
          } catch (error) { ui.fail(error); }
        });
      });

      const newRun = container.querySelector('#new-run');
      if (newRun) newRun.addEventListener('click', () => generateDialog(App));
    },
  };
}(window));
