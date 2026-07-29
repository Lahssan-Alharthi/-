/* التقارير */
(function registerReports(global) {
  'use strict';

  global.PAGES = global.PAGES || {};

  const REPORTS = [
    { key: 'attendance', title: 'تقرير الحضور الشهري', icon: '🕒', desc: 'ملخّص حضور وتأخير وغياب كل موظف خلال شهر محدد', periodic: true },
    { key: 'leaves', title: 'تقرير الإجازات', icon: '🌴', desc: 'كل طلبات الإجازات وحالتها خلال سنة محددة', yearly: true },
    { key: 'headcount', title: 'تقرير القوى العاملة', icon: '👥', desc: 'توزيع الموظفين على الأقسام حسب الجنس ونوع العقد' },
    { key: 'payroll-cost', title: 'تقرير تكلفة الرواتب', icon: '💰', desc: 'إجمالي الاستحقاقات والاستقطاعات لكل مسيّر رواتب', roles: ['admin', 'finance', 'hr'] },
    { key: 'trips', title: 'تقرير عمليات النقل', icon: '🚚', desc: 'الرحلات المنفّذة خلال فترة محددة مع المسافات والتكاليف', range: true },
  ];

  async function preview(report, params) {
    const result = await api.get(`/reports/${report.key}${api.qs(params)}`);
    const rows = result.data;

    const columns = rows.length
      ? Object.keys(rows[0]).map((key) => ({ title: key, key, cls: typeof rows[0][key] === 'number' ? 'num' : '' }))
      : [];

    const modal = ui.modal(report.title, `
      <div class="mb-1 muted small">${ui.number(rows.length)} سجل</div>
      ${ui.table(columns, rows, 'لا توجد بيانات لهذه الفترة')}`, {
      wide: true,
      footer: '<button class="btn accent" id="dl">تنزيل CSV</button>',
    });

    modal.el.querySelector('#dl').addEventListener('click', () => {
      api.download(`/reports/${report.key}${api.qs({ ...params, format: 'csv' })}`);
    });
  }

  global.PAGES.reports = {
    async render(container, App) {
      const summary = await api.get('/reports/summary');
      const data = summary.data;

      const now = new Date();
      const available = REPORTS.filter((r) => !r.roles || App.hasRole(r.roles));

      const cards = available.map((report) => `
        <div class="card">
          <div class="card-head"><h3>${report.icon} ${report.title}</h3></div>
          <div class="card-body">
            <p class="small muted">${report.desc}</p>
            <div class="filters" data-report="${report.key}">
              ${report.periodic ? `
                <div class="field">
                  <label>السنة</label>
                  <input type="number" data-p="year" value="${now.getFullYear()}" min="2000" max="2100">
                </div>
                <div class="field">
                  <label>الشهر</label>
                  <select data-p="month">
                    ${ui.ARABIC_MONTHS.map((m, i) => `<option value="${i + 1}" ${i === now.getMonth() ? 'selected' : ''}>${m}</option>`).join('')}
                  </select>
                </div>` : ''}
              ${report.yearly ? `
                <div class="field">
                  <label>السنة</label>
                  <input type="number" data-p="year" value="${now.getFullYear()}" min="2000" max="2100">
                </div>` : ''}
              ${report.range ? `
                <div class="field">
                  <label>من</label>
                  <input type="date" data-p="from" value="${new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)}">
                </div>
                <div class="field">
                  <label>إلى</label>
                  <input type="date" data-p="to" value="${now.toISOString().slice(0, 10)}">
                </div>` : ''}
              <button class="btn" data-view="${report.key}">عرض</button>
              <button class="btn secondary" data-csv="${report.key}">تنزيل CSV</button>
            </div>
          </div>
        </div>`).join('');

      container.innerHTML = `
        <div class="grid grid-2 mb-2">
          <div class="card">
            <div class="card-head"><h3>الإجازات المعتمدة حسب النوع</h3></div>
            <div class="card-body">${ui.bars(data.leaves_by_type)}</div>
          </div>
          <div class="card">
            <div class="card-head"><h3>الرحلات حسب الحالة</h3></div>
            <div class="card-body">${ui.bars(data.trips_by_status.map((r) => ({ label: ui.statusText(r.label), value: r.value })))}</div>
          </div>
          <div class="card">
            <div class="card-head"><h3>حركة الرحلات الشهرية</h3></div>
            <div class="card-body">${ui.bars(data.monthly_trips.slice().reverse())}</div>
          </div>
          <div class="card">
            <div class="card-head"><h3>أكثر الوجهات تكراراً</h3></div>
            <div class="card-body">${ui.bars(data.top_destinations)}</div>
          </div>
        </div>

        <h2>التقارير التفصيلية</h2>
        <div class="grid grid-2">${cards}</div>`;

      const collect = (key) => {
        const scope = container.querySelector(`.filters[data-report="${key}"]`);
        const params = {};
        scope.querySelectorAll('[data-p]').forEach((input) => { params[input.dataset.p] = input.value; });
        return params;
      };

      container.querySelectorAll('[data-view]').forEach((button) => {
        button.addEventListener('click', async () => {
          const report = available.find((r) => r.key === button.dataset.view);
          try {
            await preview(report, collect(report.key));
          } catch (error) { ui.fail(error); }
        });
      });

      container.querySelectorAll('[data-csv]').forEach((button) => {
        button.addEventListener('click', () => {
          const key = button.dataset.csv;
          api.download(`/reports/${key}${api.qs({ ...collect(key), format: 'csv' })}`);
        });
      });
    },
  };
}(window));
