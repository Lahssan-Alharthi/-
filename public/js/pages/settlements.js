/* السلف ومخالصات نهاية الخدمة */
(function registerSettlements(global) {
  'use strict';

  global.PAGES = global.PAGES || {};

  const LOAN_STATUS = {
    active: { text: 'قائمة', cls: 'info' },
    settled: { text: 'مسدّدة', cls: 'ok' },
    cancelled: { text: 'ملغاة', cls: 'neutral' },
  };

  const EOS_STATUS = {
    draft: { text: 'مسودة', cls: 'neutral' },
    approved: { text: 'معتمدة', cls: 'ok' },
    paid: { text: 'مصروفة', cls: 'brand' },
  };

  const badge = (map, value) => {
    const entry = map[value];
    return entry ? `<span class="badge ${entry.cls}">${entry.text}</span>`
      : `<span class="badge neutral">${ui.esc(value || '—')}</span>`;
  };

  // ------------------------------------------------------------- السلف

  /**
   * نافذة تسجيل سلفة. صاحب الصلاحية يحدّد إمّا عدد الأقساط وإمّا
   * مبلغ القسط الشهري، ويُحسب الآخر تلقائياً أمامه.
   */
  function loanDialog(employees, App) {
    const now = new Date();
    const modal = ui.modal('تسجيل سلفة على الراتب', `
      <form id="loan-form">
        <div class="form-grid">
          <div class="field">
            <label>الموظف *</label>
            <select name="employee_id" required>
              <option value="">— اختر الموظف —</option>
              ${ui.options(employees, 'id', 'full_name_ar')}
            </select>
          </div>
          <div class="field">
            <label>مبلغ السلفة (ر.س) *</label>
            <input type="number" name="amount" required min="1" step="0.01" id="loan-amount">
          </div>
        </div>

        <div class="field">
          <label>طريقة التقسيط</label>
          <div class="btn-row" role="group">
            <button type="button" class="btn secondary sm" data-mode="count" id="mode-count">بعدد الأقساط</button>
            <button type="button" class="btn secondary sm" data-mode="amount" id="mode-amount">بمبلغ القسط</button>
          </div>
          <div class="hint">اختر ما يناسبك، ويُحسب الآخر تلقائياً.</div>
        </div>

        <div class="form-grid">
          <div class="field" id="field-count">
            <label>عدد الأقساط</label>
            <input type="number" name="installments" min="1" step="1" value="1" id="loan-count">
          </div>
          <div class="field hidden" id="field-amount">
            <label>مبلغ القسط الشهري (ر.س)</label>
            <input type="number" name="monthly_amount" min="0.01" step="0.01" id="loan-monthly">
          </div>
          <div class="field">
            <label>سنة بداية الخصم</label>
            <input type="number" name="start_year" min="2000" max="2100" value="${now.getFullYear()}">
          </div>
          <div class="field">
            <label>شهر بداية الخصم</label>
            <select name="start_month">
              ${ui.ARABIC_MONTHS.map((m, i) => `<option value="${i + 1}" ${i === now.getMonth() ? 'selected' : ''}>${m}</option>`).join('')}
            </select>
          </div>
          <div class="field full">
            <label>ملاحظات</label>
            <input type="text" name="notes" placeholder="سبب السلفة أو مرجع الاعتماد">
          </div>
        </div>

        <div class="badge neutral" style="display:block" id="loan-preview">حدّد المبلغ لعرض الجدول</div>
      </form>`, {
      wide: true,
      footer: '<button class="btn" form="loan-form" type="submit">تسجيل السلفة</button>',
    });

    const form = modal.el.querySelector('#loan-form');
    const amountInput = modal.el.querySelector('#loan-amount');
    const countInput = modal.el.querySelector('#loan-count');
    const monthlyInput = modal.el.querySelector('#loan-monthly');
    const preview = modal.el.querySelector('#loan-preview');
    let mode = 'count';

    const round2 = (n) => Math.round(n * 100) / 100;

    const refresh = () => {
      const amount = Number(amountInput.value);
      if (!amount || amount <= 0) {
        preview.textContent = 'حدّد المبلغ لعرض الجدول';
        preview.className = 'badge neutral';
        return;
      }

      let count;
      let monthly;

      if (mode === 'amount') {
        monthly = Number(monthlyInput.value);
        if (!monthly || monthly <= 0) {
          preview.textContent = 'حدّد مبلغ القسط';
          preview.className = 'badge neutral';
          return;
        }
        if (monthly > amount) {
          preview.textContent = 'مبلغ القسط لا يمكن أن يتجاوز مبلغ السلفة';
          preview.className = 'badge danger';
          return;
        }
        count = Math.ceil(round2(amount / monthly) - 0.0001);
      } else {
        count = Math.max(1, Math.floor(Number(countInput.value) || 1));
        monthly = round2(amount / count);
      }

      const last = round2(amount - monthly * (count - 1));
      preview.className = 'badge brand';
      preview.textContent = count === 1
        ? `قسط واحد بمقدار ${ui.money(amount)}`
        : `${count} قسط: ${count - 1} × ${ui.money(monthly)}`
          + (Math.abs(last - monthly) > 0.001 ? ` والأخير ${ui.money(last)}` : '');
    };

    const setMode = (next) => {
      mode = next;
      modal.el.querySelector('#field-count').classList.toggle('hidden', next !== 'count');
      modal.el.querySelector('#field-amount').classList.toggle('hidden', next !== 'amount');
      countInput.disabled = next !== 'count';
      monthlyInput.disabled = next !== 'amount';
      modal.el.querySelector('#mode-count').className = `btn sm ${next === 'count' ? '' : 'secondary'}`;
      modal.el.querySelector('#mode-amount').className = `btn sm ${next === 'amount' ? '' : 'secondary'}`;
      refresh();
    };

    modal.el.querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => setMode(button.dataset.mode));
    });
    [amountInput, countInput, monthlyInput].forEach((input) => {
      input.addEventListener('input', refresh);
    });
    setMode('count');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = ui.formData(form);
      // نرسل الحقل المستخدم فقط حتى لا يتعارض المدخلان على الخادم
      if (mode === 'amount') delete data.installments;
      else delete data.monthly_amount;

      try {
        const result = await api.post('/loans', data);
        modal.close();
        ui.toast(result.message, 'success');
        App.refresh();
      } catch (error) { ui.fail(error); }
    });
  }

  /** نافذة إعادة جدولة المتبقّي. */
  function rescheduleDialog(loan, App) {
    const modal = ui.modal(`إعادة جدولة سلفة ${ui.esc(loan.employee_name)}`, `
      <div class="info-list mb-2">
        <div class="row"><span class="k">مبلغ السلفة</span><span class="v money">${ui.money(loan.amount)}</span></div>
        <div class="row"><span class="k">المسدّد</span><span class="v money">${ui.money(loan.paid_amount)}</span></div>
        <div class="row"><span class="k">المتبقّي</span><span class="v money">${ui.money(loan.remaining_amount)}</span></div>
        <div class="row"><span class="k">القسط الحالي</span><span class="v money">${ui.money(loan.monthly_amount)}</span></div>
      </div>
      <form id="resched-form">
        <div class="form-grid">
          <div class="field">
            <label>عدد أقساط جديد للمتبقّي</label>
            <input type="number" name="installments" min="1" step="1">
          </div>
          <div class="field">
            <label>أو مبلغ قسط جديد (ر.س)</label>
            <input type="number" name="monthly_amount" min="0.01" step="0.01">
          </div>
        </div>
        <div class="field">
          <label>ملاحظات</label>
          <input type="text" name="notes" value="${ui.esc(loan.notes || '')}">
        </div>
        <p class="small muted mb-0">تُطبَّق الجدولة الجديدة على المتبقّي فقط، ولا تمسّ الأقساط المسدّدة.</p>
      </form>`, {
      footer: '<button class="btn" form="resched-form" type="submit">حفظ الجدولة</button>',
    });

    modal.el.querySelector('#resched-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = ui.formData(event.target);
      if (!data.installments && !data.monthly_amount) {
        ui.toast('حدّد عدد أقساط أو مبلغ قسط', 'error');
        return;
      }
      if (data.monthly_amount) delete data.installments;
      else delete data.monthly_amount;

      try {
        const result = await api.put(`/loans/${loan.id}`, data);
        modal.close();
        ui.toast(result.message, 'success');
        App.refresh();
      } catch (error) { ui.fail(error); }
    });
  }

  /** جدول أقساط سلفة. */
  async function showLoanSchedule(loanId) {
    const result = await api.get(`/loans/${loanId}`);
    const loan = result.data;

    ui.modal(`جدول أقساط: ${ui.esc(loan.employee_name)}`, `
      <div class="grid grid-3 mb-2">
        ${ui.stat('💵', 'مبلغ السلفة', ui.money(loan.amount), `${ui.number(loan.installments)} قسط`)}
        ${ui.stat('✅', 'المسدّد', ui.money(loan.paid_amount), `${ui.number(loan.paid_installments)} قسط`, 'ok')}
        ${ui.stat('⏳', 'المتبقّي', ui.money(loan.remaining_amount), `القسط ${ui.money(loan.monthly_amount)}`, 'warn')}
      </div>
      ${ui.table([
    { title: 'الشهر', render: (r) => `${ui.ARABIC_MONTHS[r.month - 1]} ${r.year}` },
    { title: 'المبلغ المخصوم', cls: 'num', render: (r) => ui.money(r.amount) },
    { title: 'حالة المسيّر', render: (r) => ui.status(r.run_status) },
    { title: 'تاريخ التسجيل', render: (r) => ui.dateShort(r.created_at) },
  ], loan.payments, 'لم تُخصم أقساط بعد')}`, { wide: true, footer: null });
  }

  // ------------------------------------------- مخالصة نهاية الخدمة

  /** يعرض تفصيل المخالصة المحسوبة. */
  function settlementBreakdown(data) {
    const line = (label, value, negative) => `
      <div class="row">
        <span class="k">${label}</span>
        <span class="v money" style="${negative ? 'color:var(--danger)' : ''}">${negative ? '−' : ''}${ui.money(value)}</span>
      </div>`;

    return `
      <div class="grid grid-2">
        <div>
          <h3>المستحقات</h3>
          <div class="info-list" style="grid-template-columns:1fr">
            <div class="row"><span class="k">مدة الخدمة</span>
              <span class="v">${ui.number(data.service_breakdown.years)} سنة و ${ui.number(data.service_breakdown.months)} شهر</span></div>
            <div class="row"><span class="k">الأجر المعتمد</span>
              <span class="v money">${ui.money(data.monthly_wage)}</span></div>
            ${line('مكافأة نهاية الخدمة', data.gratuity_amount)}
            ${data.gratuity_factor < 1 ? `<div class="row"><span class="k">نسبة الاستحقاق (استقالة)</span>
              <span class="v">${Math.round(data.gratuity_factor * 100)}% من ${ui.money(data.gratuity_before_factor)}</span></div>` : ''}
            ${line(`بدل إجازات غير مستنفدة (${ui.number(data.unused_leave_days)} يوم)`, data.unused_leave_amount)}
            ${line('مستحقات أخرى', data.other_dues)}
            <div class="row"><span class="k"><b>إجمالي المستحقات</b></span>
              <span class="v money">${ui.money(data.total_dues)}</span></div>
          </div>
        </div>
        <div>
          <h3>الاستقطاعات</h3>
          <div class="info-list" style="grid-template-columns:1fr">
            ${line('أرصدة السلف القائمة', data.outstanding_loans, true)}
            ${line('استقطاعات أخرى', data.other_deductions, true)}
            <div class="row"><span class="k"><b>إجمالي الاستقطاعات</b></span>
              <span class="v money" style="color:var(--danger)">−${ui.money(data.total_deductions)}</span></div>
          </div>
        </div>
      </div>

      ${data.note ? `<p class="badge warn" style="display:block;margin-top:1rem">${ui.esc(data.note)}</p>` : ''}

      <div class="payslip-total mt-2" style="border-radius:var(--radius-sm)">
        <span>صافي المخالصة</span>
        <span class="money">${ui.money(data.net_amount)}</span>
      </div>`;
  }

  /** نافذة إعداد مخالصة: تقدير مباشر ثم حفظ كمسودة. */
  async function settlementDialog(employees, reasons, App) {
    const today = new Date().toISOString().slice(0, 10);

    const modal = ui.modal('إعداد مخالصة نهاية خدمة', `
      <form id="eos-form">
        <div class="form-grid">
          <div class="field">
            <label>الموظف *</label>
            <select name="employee_id" required id="eos-employee">
              <option value="">— اختر الموظف —</option>
              ${ui.options(employees, 'id', 'full_name_ar')}
            </select>
          </div>
          <div class="field">
            <label>يوم العمل الأخير *</label>
            <input type="date" name="last_working_day" required value="${today}" id="eos-date">
          </div>
          <div class="field">
            <label>سبب انتهاء العلاقة *</label>
            <select name="reason" required id="eos-reason">
              ${Object.entries(reasons).map(([key, label]) => `<option value="${key}">${ui.esc(label)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>أيام إجازة غير مستنفدة</label>
            <input type="number" name="unused_leave_days" min="0" step="0.5" id="eos-leave"
                   placeholder="يُحسب تلقائياً من الرصيد">
          </div>
          <div class="field">
            <label>مستحقات أخرى (ر.س)</label>
            <input type="number" name="other_dues" min="0" step="0.01" value="0" id="eos-dues">
          </div>
          <div class="field">
            <label>استقطاعات أخرى (ر.س)</label>
            <input type="number" name="other_deductions" min="0" step="0.01" value="0" id="eos-ded">
          </div>
          <div class="field full">
            <label>ملاحظات</label>
            <input type="text" name="notes">
          </div>
        </div>
      </form>

      <div id="eos-preview" class="mt-2">
        <div class="empty">اختر الموظف والتاريخ لعرض المخالصة المحسوبة</div>
      </div>`, {
      wide: true,
      footer: `<button class="btn" id="eos-save" type="button" disabled>حفظ كمسودة</button>
               <button class="btn secondary" id="eos-calc" type="button">إعادة الحساب</button>`,
    });

    const form = modal.el.querySelector('#eos-form');
    const preview = modal.el.querySelector('#eos-preview');
    const saveButton = modal.el.querySelector('#eos-save');

    const calculate = async () => {
      const employeeId = form.employee_id.value;
      if (!employeeId) return;

      const params = {
        last_working_day: form.last_working_day.value,
        reason: form.reason.value,
        other_dues: form.other_dues.value || 0,
        other_deductions: form.other_deductions.value || 0,
      };
      if (form.unused_leave_days.value !== '') params.unused_leave_days = form.unused_leave_days.value;

      preview.innerHTML = '<div class="boot" style="padding:1.5rem"><div class="spinner"></div></div>';
      try {
        const result = await api.get(`/end-of-service/estimate/${employeeId}${api.qs(params)}`);
        preview.innerHTML = settlementBreakdown(result.data);
        saveButton.disabled = false;

        // يُعرض الرصيد المحتسب تلقائياً في الحقل ليكون قابلاً للتعديل
        if (form.unused_leave_days.value === '') {
          form.unused_leave_days.placeholder = `${result.data.unused_leave_days} يوم (محتسب)`;
        }
      } catch (error) {
        preview.innerHTML = ui.empty(error.message, '⚠️');
        saveButton.disabled = true;
      }
    };

    ['#eos-employee', '#eos-date', '#eos-reason', '#eos-leave', '#eos-dues', '#eos-ded']
      .forEach((selector) => {
        modal.el.querySelector(selector).addEventListener('change', calculate);
      });
    modal.el.querySelector('#eos-calc').addEventListener('click', calculate);

    saveButton.addEventListener('click', async () => {
      const data = ui.formData(form);
      if (data.unused_leave_days === '') delete data.unused_leave_days;

      try {
        const result = await api.post('/end-of-service', data);
        modal.close();
        ui.toast(result.message, 'success');
        App.refresh();
      } catch (error) { ui.fail(error); }
    });
  }

  /** عرض مخالصة محفوظة. */
  async function showSettlement(id, App, canApprove) {
    const result = await api.get(`/end-of-service/${id}`);
    const s = result.data;

    const data = {
      service_breakdown: {
        years: Math.floor(s.service_years),
        months: Math.floor((s.service_years - Math.floor(s.service_years)) * 12),
      },
      monthly_wage: s.monthly_wage,
      gratuity_amount: s.gratuity_amount,
      gratuity_factor: s.gratuity_factor,
      gratuity_before_factor: s.gratuity_factor
        ? Math.round((s.gratuity_amount / s.gratuity_factor) * 100) / 100 : 0,
      unused_leave_days: s.unused_leave_days,
      unused_leave_amount: s.unused_leave_amount,
      other_dues: s.other_dues,
      outstanding_loans: s.outstanding_loans,
      other_deductions: s.other_deductions,
      total_dues: Math.round((s.gratuity_amount + s.unused_leave_amount + s.other_dues) * 100) / 100,
      total_deductions: Math.round((s.outstanding_loans + s.other_deductions) * 100) / 100,
      net_amount: s.net_amount,
      note: null,
    };

    const footer = [];
    if (canApprove && s.status === 'draft') {
      footer.push('<button class="btn" id="approve-eos">اعتماد المخالصة وإنهاء الخدمة</button>');
    }
    if (canApprove && s.status === 'approved') {
      footer.push('<button class="btn" id="pay-eos">تعليم كمصروفة</button>');
    }
    footer.push('<button class="btn secondary" onclick="window.print()">طباعة</button>');

    const modal = ui.modal(`مخالصة نهاية الخدمة — ${ui.esc(s.employee_name)}`, `
      <div class="payslip-head" style="border-radius:var(--radius-sm);margin-bottom:1rem">
        <div>
          <div style="font-size:1.1rem;font-weight:700">${ui.esc(s.employee_name)}</div>
          <div style="opacity:.85;font-size:.85rem">${ui.esc(s.employee_no)} — ${ui.esc(s.department_name || '')}</div>
        </div>
        <div class="text-end">
          <div>${ui.esc(s.reason === 'resignation' ? 'استقالة' : (s.reason === 'retirement' ? 'التقاعد' : (s.reason === 'contract_end' ? 'انتهاء العقد' : 'إنهاء من صاحب العمل')))}</div>
          <div style="opacity:.85;font-size:.85rem">
            التعيين ${ui.dateShort(s.hire_date)} — آخر يوم ${ui.dateShort(s.last_working_day)}
          </div>
        </div>
      </div>
      ${settlementBreakdown(data)}
      <p class="small muted mt-2 mb-0">
        الحالة: ${badge(EOS_STATUS, s.status)}
        ${s.created_by_name ? ` — أعدّها ${ui.esc(s.created_by_name)}` : ''}
        ${s.approved_by_name ? ` — اعتمدها ${ui.esc(s.approved_by_name)}` : ''}
      </p>`, { wide: true, footer: footer.join(' ') });

    const approve = modal.el.querySelector('#approve-eos');
    if (approve) {
      approve.addEventListener('click', async () => {
        const ok = await ui.confirm('اعتماد المخالصة',
          `سيتم إنهاء خدمة ${s.employee_name} وتسوية سلفه القائمة. لا يمكن التراجع.`,
          'اعتماد', 'accent');
        if (!ok) return;
        try {
          const response = await api.post(`/end-of-service/${id}/approve`, {});
          modal.close();
          ui.toast(response.message, 'success');
          App.refresh();
        } catch (error) { ui.fail(error); }
      });
    }

    const pay = modal.el.querySelector('#pay-eos');
    if (pay) {
      pay.addEventListener('click', async () => {
        try {
          const response = await api.post(`/end-of-service/${id}/pay`, {});
          modal.close();
          ui.toast(response.message, 'success');
          App.refresh();
        } catch (error) { ui.fail(error); }
      });
    }
  }

  // ------------------------------------------------------------ الصفحة

  global.PAGES.settlements = {
    async render(container, App) {
      const canManageLoans = App.hasRole('admin', 'finance');
      const canManageEos = App.hasRole('admin', 'hr', 'finance');
      const isEmployee = !canManageEos;

      const requests = [api.get('/loans')];
      if (canManageEos) {
        requests.push(
          api.get('/end-of-service'),
          api.get('/end-of-service/reasons'),
          api.get('/employees/lookup'),
        );
      }

      const [loansResult, eosResult, reasonsResult, lookupResult] = await Promise.all(requests);
      const loans = loansResult.data;
      const settlements = eosResult ? eosResult.data : [];
      const employees = lookupResult ? lookupResult.data : [];

      const activeLoans = loans.filter((l) => l.status === 'active');

      const loanColumns = [
        ...(isEmployee ? [] : [{
          title: 'الموظف',
          render: (r) => `<a href="#/profile?id=${r.employee_id}">${ui.esc(r.employee_name)}</a>`,
        }]),
        { title: 'المبلغ', cls: 'num', render: (r) => ui.money(r.amount) },
        { title: 'القسط الشهري', cls: 'num', render: (r) => ui.money(r.monthly_amount) },
        {
          title: 'التقدّم',
          render: (r) => {
            const percent = r.amount ? (r.paid_amount / r.amount) * 100 : 0;
            return `<div style="min-width:120px">
              <div class="bar-track"><div class="bar-fill" style="width:${percent}%"></div></div>
              <div class="small muted">${ui.number(r.paid_installments)} من ${ui.number(r.installments)} قسط</div>
            </div>`;
          },
        },
        { title: 'المسدّد', cls: 'num', render: (r) => ui.money(r.paid_amount) },
        { title: 'المتبقّي', cls: 'num', render: (r) => `<b class="money">${ui.money(r.remaining_amount)}</b>` },
        { title: 'بداية الخصم', render: (r) => `${ui.ARABIC_MONTHS[r.start_month - 1]} ${r.start_year}` },
        { title: 'الحالة', render: (r) => badge(LOAN_STATUS, r.status) },
        {
          title: 'إجراءات',
          render: (r) => {
            const buttons = [`<button class="btn sm secondary" data-schedule="${r.id}">الجدول</button>`];
            if (canManageLoans && r.status === 'active') {
              buttons.push(`<button class="btn sm secondary" data-resched="${r.id}">إعادة جدولة</button>`);
              buttons.push(`<button class="btn sm danger" data-cancel-loan="${r.id}">إيقاف</button>`);
            }
            return `<div class="btn-row">${buttons.join('')}</div>`;
          },
        },
      ];

      const eosColumns = [
        { title: 'الموظف', render: (r) => `${ui.esc(r.employee_name)}<div class="small muted">${ui.esc(r.employee_no)}</div>` },
        { title: 'القسم', key: 'department_name' },
        { title: 'آخر يوم عمل', render: (r) => ui.dateShort(r.last_working_day) },
        {
          title: 'السبب',
          render: (r) => `<span class="badge neutral">${ui.esc(
            r.reason === 'resignation' ? 'استقالة'
              : (r.reason === 'retirement' ? 'تقاعد'
                : (r.reason === 'contract_end' ? 'انتهاء عقد' : 'إنهاء')),
          )}</span>`,
        },
        { title: 'مدة الخدمة', render: (r) => `${ui.number(r.service_years)} سنة` },
        { title: 'المكافأة', cls: 'num', render: (r) => ui.money(r.gratuity_amount) },
        { title: 'الصافي', cls: 'num', render: (r) => `<b class="money">${ui.money(r.net_amount)}</b>` },
        { title: 'الحالة', render: (r) => badge(EOS_STATUS, r.status) },
        {
          title: '',
          render: (r) => `<button class="btn sm secondary" data-eos="${r.id}">عرض</button>`,
        },
      ];

      container.innerHTML = `
        <div class="grid grid-4 mb-2">
          ${ui.stat('💵', isEmployee ? 'سلفي القائمة' : 'إجمالي السلف القائمة',
    ui.money(loansResult.summary.outstanding), `${ui.number(activeLoans.length)} سلفة`, 'warn')}
          ${ui.stat('📋', 'إجمالي السلف', ui.number(loans.length),
    `مسدّدة ${ui.number(loans.filter((l) => l.status === 'settled').length)}`, 'info')}
          ${canManageEos ? ui.stat('📄', 'مخالصات قائمة',
    ui.number(settlements.filter((s) => s.status !== 'paid').length),
    `إجمالي ${ui.number(settlements.length)}`, 'accent') : ''}
          ${canManageEos ? ui.stat('💰', 'صافي المخالصات المعتمدة',
    ui.money(settlements.filter((s) => s.status !== 'draft')
      .reduce((sum, s) => sum + s.net_amount, 0)), 'مستحقة الصرف', 'ok') : ''}
        </div>

        <div class="card">
          <div class="card-head">
            <h3>${isEmployee ? 'سلفي' : 'السلف على الرواتب'}</h3><div class="spacer"></div>
            ${canManageLoans ? '<button class="btn accent" id="add-loan">+ تسجيل سلفة</button>' : ''}
          </div>
          ${canManageLoans ? `<div class="card-body">
            <p class="small muted mb-0">
              يحدّد صاحب الصلاحية التقسيط بمرونة: بعدد الأقساط أو بمبلغ القسط الشهري.
              ويُخصم القسط من كل مسيّر رواتب معتمد، ولا يُسجَّل مسدّداً قبل الاعتماد.
            </p>
          </div>` : ''}
          <div class="card-body tight">
            ${ui.table(loanColumns, loans, isEmployee ? 'لا توجد سلف على راتبك' : 'لا توجد سلف مسجّلة')}
          </div>
        </div>

        ${canManageEos ? `
          <div class="card">
            <div class="card-head">
              <h3>مخالصات نهاية الخدمة</h3><div class="spacer"></div>
              <button class="btn accent" id="add-eos">+ إعداد مخالصة</button>
            </div>
            <div class="card-body">
              <p class="small muted mb-0">
                تُحسب المكافأة على أساس مدة الخدمة والأجر، ويُضاف بدل الإجازات غير المستنفدة،
                وتُحسم أرصدة السلف القائمة. واعتماد المخالصة يُنهي خدمة الموظف ويسوّي سلفه.
              </p>
            </div>
            <div class="card-body tight">
              ${ui.table(eosColumns, settlements, 'لا توجد مخالصات')}
            </div>
          </div>` : ''}`;

      const addLoan = container.querySelector('#add-loan');
      if (addLoan) addLoan.addEventListener('click', () => loanDialog(employees, App));

      const addEos = container.querySelector('#add-eos');
      if (addEos) {
        addEos.addEventListener('click', () => settlementDialog(employees, reasonsResult.data, App));
      }

      container.querySelectorAll('[data-schedule]').forEach((button) => {
        button.addEventListener('click', () => showLoanSchedule(button.dataset.schedule).catch(ui.fail));
      });

      container.querySelectorAll('[data-resched]').forEach((button) => {
        button.addEventListener('click', () => {
          rescheduleDialog(loans.find((l) => String(l.id) === button.dataset.resched), App);
        });
      });

      container.querySelectorAll('[data-cancel-loan]').forEach((button) => {
        button.addEventListener('click', async () => {
          const loan = loans.find((l) => String(l.id) === button.dataset.cancelLoan);
          const ok = await ui.confirm('إيقاف خصم السلفة',
            `سيتوقف الخصم والمتبقّي ${ui.money(loan.remaining_amount)} لن يُخصم من الراتب.`,
            'إيقاف الخصم');
          if (!ok) return;
          try {
            const result = await api.post(`/loans/${loan.id}/cancel`, { reason: 'إيقاف من الإدارة' });
            ui.toast(result.message, 'success');
            App.refresh();
          } catch (error) { ui.fail(error); }
        });
      });

      container.querySelectorAll('[data-eos]').forEach((button) => {
        button.addEventListener('click', () => {
          showSettlement(button.dataset.eos, App, App.hasRole('admin', 'finance')).catch(ui.fail);
        });
      });
    },
  };
}(window));
