/* الإجازات */
(function registerLeaves(global) {
  'use strict';

  global.PAGES = global.PAGES || {};

  function requestDialog(types, balance, App) {
    const today = new Date().toISOString().slice(0, 10);
    const modal = ui.modal('تقديم طلب إجازة', `
      <form id="leave-form">
        <div class="badge info" style="display:block;margin-bottom:1rem">
          رصيدك المتاح: ${ui.number(balance.remaining)} يوم من أصل ${ui.number(balance.entitlement)} يوم
        </div>
        <div class="form-grid">
          <div class="field full">
            <label>نوع الإجازة *</label>
            <select name="leave_type_id" required id="type-select">
              <option value="">— اختر النوع —</option>
              ${types.map((t) => `<option value="${t.id}" data-max="${t.max_days || ''}" data-deducts="${t.deducts_balance}">${ui.esc(t.name_ar)}${t.max_days ? ` (حتى ${t.max_days} يوم)` : ''}</option>`).join('')}
            </select>
            <div class="hint" id="type-hint"></div>
          </div>
          <div class="field">
            <label>من تاريخ *</label>
            <input type="date" name="start_date" required min="${today}" id="start">
          </div>
          <div class="field">
            <label>إلى تاريخ *</label>
            <input type="date" name="end_date" required min="${today}" id="end">
          </div>
          <div class="field full">
            <label>سبب الإجازة</label>
            <textarea name="reason" placeholder="اذكر سبب الطلب باختصار"></textarea>
          </div>
        </div>
        <div class="badge neutral" style="display:block" id="days-preview">عدد الأيام: —</div>
      </form>`, {
      footer: '<button class="btn" form="leave-form" type="submit">إرسال الطلب</button>',
    });

    const start = modal.el.querySelector('#start');
    const end = modal.el.querySelector('#end');
    const preview = modal.el.querySelector('#days-preview');
    const typeSelect = modal.el.querySelector('#type-select');
    const typeHint = modal.el.querySelector('#type-hint');

    const updateDays = () => {
      if (!start.value || !end.value) { preview.textContent = 'عدد الأيام: —'; return; }
      const days = Math.floor((Date.parse(end.value) - Date.parse(start.value)) / 86400000) + 1;
      preview.textContent = days > 0 ? `عدد الأيام: ${days} يوم` : 'تاريخ النهاية يجب أن يكون بعد البداية';
      preview.className = `badge ${days > 0 ? 'brand' : 'danger'}`;
      preview.style.display = 'block';
    };

    start.addEventListener('change', () => { end.min = start.value; updateDays(); });
    end.addEventListener('change', updateDays);

    typeSelect.addEventListener('change', () => {
      const option = typeSelect.selectedOptions[0];
      typeHint.textContent = option && option.dataset.deducts === '1'
        ? 'هذا النوع يُخصم من رصيد الإجازة السنوية.'
        : (option && option.value ? 'هذا النوع لا يُخصم من الرصيد السنوي.' : '');
    });

    modal.el.querySelector('#leave-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const result = await api.post('/leaves', ui.formData(event.target));
        modal.close();
        ui.toast(result.message, 'success');
        App.refresh();
      } catch (error) { ui.fail(error); }
    });
  }

  function decisionDialog(leave, decision, App) {
    const isApprove = decision === 'approved';
    const modal = ui.modal(isApprove ? 'اعتماد طلب الإجازة' : 'رفض طلب الإجازة', `
      <div class="info-list mb-2">
        <div class="row"><span class="k">الموظف</span><span class="v">${ui.esc(leave.employee_name)}</span></div>
        <div class="row"><span class="k">نوع الإجازة</span><span class="v">${ui.esc(leave.leave_type_name)}</span></div>
        <div class="row"><span class="k">الفترة</span><span class="v">${ui.dateShort(leave.start_date)} → ${ui.dateShort(leave.end_date)}</span></div>
        <div class="row"><span class="k">عدد الأيام</span><span class="v">${ui.number(leave.days)}</span></div>
        <div class="row"><span class="k">السبب</span><span class="v">${ui.esc(leave.reason || '—')}</span></div>
      </div>
      <form id="dec-form">
        <div class="field">
          <label>ملاحظة القرار</label>
          <textarea name="note" placeholder="${isApprove ? 'ملاحظة اختيارية' : 'يفضّل ذكر سبب الرفض'}"></textarea>
        </div>
      </form>`, {
      footer: `<button class="btn ${isApprove ? '' : 'danger'}" form="dec-form" type="submit">${isApprove ? 'اعتماد' : 'رفض'}</button>`,
    });

    modal.el.querySelector('#dec-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const result = await api.post(`/leaves/${leave.id}/decision`, {
          decision,
          note: ui.formData(event.target).note,
        });
        modal.close();
        ui.toast(result.message, 'success');
        App.refresh();
      } catch (error) { ui.fail(error); }
    });
  }

  global.PAGES.leaves = {
    async render(container, App) {
      const canDecide = App.hasRole('admin', 'hr', 'manager');
      const scope = App.params.scope || (canDecide ? 'all' : 'mine');
      const status = App.params.status || '';

      const [typesResult, balanceResult, listResult] = await Promise.all([
        api.get('/leaves/types'),
        api.get('/leaves/balance'),
        api.get(`/leaves${api.qs({ scope, status, limit: 200 })}`),
      ]);

      const balance = balanceResult.data;
      const leaves = listResult.data;
      const pending = leaves.filter((l) => l.status === 'pending');

      const columns = [
        ...(scope !== 'mine' ? [{
          title: 'الموظف',
          render: (r) => `<a href="#/profile?id=${r.employee_id}">${ui.esc(r.employee_name)}</a>`,
        }] : []),
        { title: 'نوع الإجازة', key: 'leave_type_name' },
        { title: 'من', render: (r) => ui.dateShort(r.start_date) },
        { title: 'إلى', render: (r) => ui.dateShort(r.end_date) },
        { title: 'الأيام', cls: 'num', render: (r) => ui.number(r.days) },
        { title: 'السبب', cls: 'wrap', render: (r) => ui.esc(r.reason || '') },
        { title: 'الحالة', render: (r) => ui.status(r.status) },
        { title: 'المعتمد', render: (r) => ui.esc(r.approver_name || '') },
        { title: 'تاريخ الطلب', render: (r) => ui.dateShort(r.created_at) },
        {
          title: 'إجراءات',
          render: (r) => {
            const buttons = [];
            if (r.status === 'pending' && canDecide && r.employee_id !== App.user.id) {
              buttons.push(`<button class="btn sm" data-approve="${r.id}">اعتماد</button>`);
              buttons.push(`<button class="btn sm danger" data-reject="${r.id}">رفض</button>`);
            }
            if (r.status === 'pending' && r.employee_id === App.user.id) {
              buttons.push(`<button class="btn sm secondary" data-cancel="${r.id}">إلغاء</button>`);
            }
            return buttons.length ? `<div class="btn-row">${buttons.join('')}</div>` : '';
          },
        },
      ];

      container.innerHTML = `
        <div class="grid grid-4 mb-2">
          ${ui.stat('🌴', 'الرصيد المتبقي', `${ui.number(balance.remaining)} يوم`, `من ${ui.number(balance.entitlement)} يوم`, 'ok')}
          ${ui.stat('📅', 'المستهلك', `${ui.number(balance.used)} يوم`, `عام ${balance.year}`, 'info')}
          ${ui.stat('⏳', 'قيد الاعتماد', `${ui.number(balance.pending)} يوم`, 'طلبات لم يُبتّ فيها', 'warn')}
          ${ui.stat('📋', canDecide ? 'طلبات بانتظار القرار' : 'إجمالي طلباتي', ui.number(canDecide ? pending.length : leaves.length), '', 'accent')}
        </div>

        <div class="filters">
          ${canDecide ? `
            <div class="field">
              <label>النطاق</label>
              <select id="f-scope">
                <option value="all"  ${scope === 'all' ? 'selected' : ''}>كل الطلبات</option>
                <option value="team" ${scope === 'team' ? 'selected' : ''}>طلبات فريقي</option>
                <option value="mine" ${scope === 'mine' ? 'selected' : ''}>طلباتي</option>
              </select>
            </div>` : ''}
          <div class="field">
            <label>الحالة</label>
            <select id="f-status">
              <option value="">الكل</option>
              ${[['pending', 'قيد الاعتماد'], ['approved', 'معتمدة'], ['rejected', 'مرفوضة'], ['cancelled', 'ملغاة']]
    .map(([v, l]) => `<option value="${v}" ${status === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          <button class="btn accent" id="new-leave">+ طلب إجازة</button>
        </div>

        <div class="card">
          <div class="card-head"><h3>طلبات الإجازات</h3><div class="spacer"></div>
            <span class="muted small">${ui.number(leaves.length)} طلب</span></div>
          <div class="card-body tight">${ui.table(columns, leaves, 'لا توجد طلبات إجازة')}</div>
        </div>

        <div class="card">
          <div class="card-head"><h3>أنواع الإجازات المعتمدة</h3></div>
          <div class="card-body tight">
            ${ui.table([
    { title: 'النوع', key: 'name_ar' },
    { title: 'الحد الأقصى', render: (r) => (r.max_days ? `${ui.number(r.max_days)} يوم` : 'غير محدد') },
    { title: 'مدفوعة', render: (r) => (r.paid ? '<span class="badge ok">نعم</span>' : '<span class="badge neutral">لا</span>') },
    { title: 'تُخصم من الرصيد السنوي', render: (r) => (r.deducts_balance ? '<span class="badge warn">نعم</span>' : '<span class="badge neutral">لا</span>') },
    { title: 'تتطلب مرفقاً', render: (r) => (r.requires_attachment ? 'نعم' : 'لا') },
  ], typesResult.data)}
          </div>
        </div>`;

      container.querySelector('#new-leave').addEventListener('click',
        () => requestDialog(typesResult.data, balance, App));

      const applyFilters = () => App.go('leaves', {
        scope: container.querySelector('#f-scope') ? container.querySelector('#f-scope').value : scope,
        status: container.querySelector('#f-status').value,
      });

      const scopeSelect = container.querySelector('#f-scope');
      if (scopeSelect) scopeSelect.addEventListener('change', applyFilters);
      container.querySelector('#f-status').addEventListener('change', applyFilters);

      container.querySelectorAll('[data-approve]').forEach((button) => {
        button.addEventListener('click', () => {
          decisionDialog(leaves.find((l) => String(l.id) === button.dataset.approve), 'approved', App);
        });
      });

      container.querySelectorAll('[data-reject]').forEach((button) => {
        button.addEventListener('click', () => {
          decisionDialog(leaves.find((l) => String(l.id) === button.dataset.reject), 'rejected', App);
        });
      });

      container.querySelectorAll('[data-cancel]').forEach((button) => {
        button.addEventListener('click', async () => {
          const ok = await ui.confirm('إلغاء الطلب', 'سيتم إلغاء طلب الإجازة نهائياً.', 'إلغاء الطلب');
          if (!ok) return;
          try {
            const result = await api.post(`/leaves/${button.dataset.cancel}/cancel`);
            ui.toast(result.message, 'success');
            App.refresh();
          } catch (error) { ui.fail(error); }
        });
      });
    },
  };
}(window));
