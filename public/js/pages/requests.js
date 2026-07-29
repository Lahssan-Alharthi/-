/* طلبات الخدمات */
(function registerRequests(global) {
  'use strict';

  global.PAGES = global.PAGES || {};

  function newRequestDialog(types, App) {
    const modal = ui.modal('تقديم طلب خدمة', `
      <form id="req-form">
        <div class="field">
          <label>نوع الطلب *</label>
          <select name="type" required id="req-type">
            <option value="">— اختر النوع —</option>
            ${types.map((t) => `<option value="${ui.esc(t)}">${ui.esc(t)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>موضوع الطلب *</label>
          <input type="text" name="subject" required placeholder="مثال: خطاب تعريف موجّه للبنك">
        </div>
        <div class="field hidden" id="amount-field">
          <label>مبلغ السلفة (ر.س) *</label>
          <input type="number" name="amount" step="0.01" min="1">
          <div class="hint">تُخصم السلفة المعتمدة من راتب الشهر الذي تم اعتمادها فيه.</div>
        </div>
        <div class="field">
          <label>التفاصيل</label>
          <textarea name="details" placeholder="اشرح طلبك بالتفصيل"></textarea>
        </div>
      </form>`, {
      footer: '<button class="btn" form="req-form" type="submit">إرسال الطلب</button>',
    });

    const typeSelect = modal.el.querySelector('#req-type');
    const amountField = modal.el.querySelector('#amount-field');
    typeSelect.addEventListener('change', () => {
      const isLoan = typeSelect.value === 'سلفة';
      amountField.classList.toggle('hidden', !isLoan);
      amountField.querySelector('input').required = isLoan;
    });

    modal.el.querySelector('#req-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const result = await api.post('/requests', ui.formData(event.target));
        modal.close();
        ui.toast(result.message, 'success');
        App.refresh();
      } catch (error) { ui.fail(error); }
    });
  }

  function decisionDialog(request, App) {
    const modal = ui.modal(`معالجة الطلب: ${request.type}`, `
      <div class="info-list mb-2">
        <div class="row"><span class="k">مقدّم الطلب</span><span class="v">${ui.esc(request.employee_name)}</span></div>
        <div class="row"><span class="k">الموضوع</span><span class="v">${ui.esc(request.subject)}</span></div>
        ${request.amount ? `<div class="row"><span class="k">المبلغ</span><span class="v money">${ui.money(request.amount)}</span></div>` : ''}
        <div class="row"><span class="k">تاريخ الطلب</span><span class="v">${ui.dateShort(request.created_at)}</span></div>
      </div>
      ${request.details ? `<div class="card"><div class="card-body">${ui.esc(request.details)}</div></div>` : ''}
      <form id="dec-form">
        <div class="field">
          <label>القرار *</label>
          <select name="decision" required>
            <option value="approved">اعتماد الطلب</option>
            <option value="in_progress">قيد التنفيذ</option>
            <option value="rejected">رفض الطلب</option>
          </select>
        </div>
        <div class="field">
          <label>الرد على الموظف</label>
          <textarea name="response" placeholder="نص الرد الذي سيصل للموظف"></textarea>
        </div>
      </form>`, {
      footer: '<button class="btn" form="dec-form" type="submit">حفظ القرار</button>',
    });

    modal.el.querySelector('#dec-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const result = await api.post(`/requests/${request.id}/decision`, ui.formData(event.target));
        modal.close();
        ui.toast(result.message, 'success');
        App.refresh();
      } catch (error) { ui.fail(error); }
    });
  }

  global.PAGES.requests = {
    async render(container, App) {
      const canDecide = App.hasRole('admin', 'hr', 'finance');
      const scope = App.params.scope || (canDecide ? 'all' : 'mine');
      const status = App.params.status || '';

      const [typesResult, listResult] = await Promise.all([
        api.get('/requests/types'),
        api.get(`/requests${api.qs({ scope, status })}`),
      ]);

      const requests = listResult.data;
      const counts = {
        pending: requests.filter((r) => r.status === 'pending').length,
        in_progress: requests.filter((r) => r.status === 'in_progress').length,
        approved: requests.filter((r) => r.status === 'approved').length,
        rejected: requests.filter((r) => r.status === 'rejected').length,
      };

      const columns = [
        { title: 'رقم الطلب', cls: 'num', render: (r) => `#${r.id}` },
        ...(scope !== 'mine' ? [{
          title: 'مقدّم الطلب',
          render: (r) => `<a href="#/profile?id=${r.employee_id}">${ui.esc(r.employee_name)}</a>`,
        }] : []),
        { title: 'النوع', render: (r) => `<span class="badge brand">${ui.esc(r.type)}</span>` },
        { title: 'الموضوع', cls: 'wrap', key: 'subject' },
        { title: 'المبلغ', cls: 'num', render: (r) => (r.amount ? ui.money(r.amount) : '—') },
        { title: 'الحالة', render: (r) => ui.status(r.status) },
        { title: 'الرد', cls: 'wrap', render: (r) => ui.esc(r.response || '') },
        { title: 'تاريخ الطلب', render: (r) => ui.dateShort(r.created_at) },
        {
          title: 'إجراءات',
          render: (r) => {
            const buttons = [];
            if (canDecide && ['pending', 'in_progress'].includes(r.status) && r.employee_id !== App.user.id) {
              buttons.push(`<button class="btn sm" data-decide="${r.id}">معالجة</button>`);
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
          ${ui.stat('⏳', 'قيد المعالجة', ui.number(counts.pending), 'بانتظار القرار', 'warn')}
          ${ui.stat('⚙️', 'قيد التنفيذ', ui.number(counts.in_progress), 'جارٍ العمل عليها', 'info')}
          ${ui.stat('✅', 'معتمدة', ui.number(counts.approved), '', 'ok')}
          ${ui.stat('📋', 'إجمالي الطلبات', ui.number(requests.length), `مرفوضة ${ui.number(counts.rejected)}`, 'accent')}
        </div>

        <div class="filters">
          ${canDecide ? `
            <div class="field">
              <label>النطاق</label>
              <select id="f-scope">
                <option value="all"  ${scope === 'all' ? 'selected' : ''}>كل الطلبات</option>
                <option value="mine" ${scope === 'mine' ? 'selected' : ''}>طلباتي</option>
              </select>
            </div>` : ''}
          <div class="field">
            <label>الحالة</label>
            <select id="f-status">
              <option value="">الكل</option>
              ${[['pending', 'قيد المعالجة'], ['in_progress', 'قيد التنفيذ'], ['approved', 'معتمدة'],
    ['rejected', 'مرفوضة'], ['cancelled', 'ملغاة']]
    .map(([v, l]) => `<option value="${v}" ${status === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          <button class="btn accent" id="new-request">+ طلب جديد</button>
        </div>

        <div class="card">
          <div class="card-head"><h3>طلبات الخدمات</h3></div>
          <div class="card-body tight">${ui.table(columns, requests, 'لا توجد طلبات')}</div>
        </div>`;

      container.querySelector('#new-request').addEventListener('click',
        () => newRequestDialog(typesResult.data, App));

      const applyFilters = () => App.go('requests', {
        scope: container.querySelector('#f-scope') ? container.querySelector('#f-scope').value : scope,
        status: container.querySelector('#f-status').value,
      });

      const scopeSelect = container.querySelector('#f-scope');
      if (scopeSelect) scopeSelect.addEventListener('change', applyFilters);
      container.querySelector('#f-status').addEventListener('change', applyFilters);

      container.querySelectorAll('[data-decide]').forEach((button) => {
        button.addEventListener('click', () => {
          decisionDialog(requests.find((r) => String(r.id) === button.dataset.decide), App);
        });
      });

      container.querySelectorAll('[data-cancel]').forEach((button) => {
        button.addEventListener('click', async () => {
          const ok = await ui.confirm('إلغاء الطلب', 'سيتم إلغاء الطلب نهائياً.', 'إلغاء الطلب');
          if (!ok) return;
          try {
            const result = await api.post(`/requests/${button.dataset.cancel}/cancel`);
            ui.toast(result.message, 'success');
            App.refresh();
          } catch (error) { ui.fail(error); }
        });
      });
    },
  };
}(window));
