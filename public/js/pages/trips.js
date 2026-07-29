/* الرحلات والشحنات */
(function registerTrips(global) {
  'use strict';

  global.PAGES = global.PAGES || {};

  function openForm(trip, vehicles, drivers, meta, App) {
    const t = trip || {};
    const modal = ui.modal(trip ? `تعديل الرحلة ${t.code}` : 'إنشاء رحلة جديدة', `
      <form id="trip-form">
        <div class="form-grid">
          <div class="field">
            <label>نقطة الانطلاق *</label>
            <input type="text" name="origin" required value="${ui.esc(t.origin || '')}" placeholder="الرياض">
          </div>
          <div class="field">
            <label>الوجهة *</label>
            <input type="text" name="destination" required value="${ui.esc(t.destination || '')}" placeholder="جدة">
          </div>
          <div class="field">
            <label>العميل</label>
            <input type="text" name="client_name" value="${ui.esc(t.client_name || '')}">
          </div>
          <div class="field">
            <label>نوع الشحنة</label>
            <input type="text" name="cargo" value="${ui.esc(t.cargo || '')}" placeholder="مواد غذائية مبردة">
          </div>
          <div class="field">
            <label>المركبة</label>
            <select name="vehicle_id">
              <option value="">— اختر المركبة —</option>
              ${vehicles.map((v) => `<option value="${v.id}" ${t.vehicle_id === v.id ? 'selected' : ''}>${ui.esc(v.plate_no)} — ${ui.esc(v.type)} (${ui.statusText(v.status)})</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>السائق</label>
            <select name="driver_id">
              <option value="">— اختر السائق —</option>
              ${ui.options(drivers, 'id', 'full_name_ar', t.driver_id)}
            </select>
          </div>
          <div class="field">
            <label>الوزن (كجم)</label>
            <input type="number" name="weight_kg" min="0" step="10" value="${t.weight_kg || ''}">
          </div>
          <div class="field">
            <label>المسافة (كم)</label>
            <input type="number" name="distance_km" min="0" step="1" value="${t.distance_km || ''}">
          </div>
          <div class="field">
            <label>التكلفة التقديرية (ر.س)</label>
            <input type="number" name="cost" min="0" step="0.01" value="${t.cost || ''}">
          </div>
          <div class="field">
            <label>الحالة</label>
            <select name="status">
              ${meta.statuses.map((s) => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${ui.statusText(s)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>موعد الانطلاق</label>
            <input type="datetime-local" name="depart_at" value="${ui.esc((t.depart_at || '').replace(' ', 'T').slice(0, 16))}">
          </div>
          <div class="field">
            <label>موعد الوصول المتوقع</label>
            <input type="datetime-local" name="arrive_at" value="${ui.esc((t.arrive_at || '').replace(' ', 'T').slice(0, 16))}">
          </div>
          <div class="field full">
            <label>ملاحظات</label>
            <textarea name="notes">${ui.esc(t.notes || '')}</textarea>
          </div>
        </div>
      </form>`, {
      wide: true,
      footer: '<button class="btn" form="trip-form" type="submit">حفظ</button>',
    });

    modal.el.querySelector('#trip-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const data = ui.formData(event.target);
        const result = trip
          ? await api.put(`/trips/${trip.id}`, data)
          : await api.post('/trips', data);
        modal.close();
        ui.toast(result.message, 'success');
        App.refresh();
      } catch (error) { ui.fail(error); }
    });
  }

  function statusDialog(trip, meta, App) {
    const modal = ui.modal(`تحديث حالة الرحلة ${trip.code}`, `
      <div class="info-list mb-2">
        <div class="row"><span class="k">المسار</span><span class="v">${ui.esc(trip.origin)} → ${ui.esc(trip.destination)}</span></div>
        <div class="row"><span class="k">المركبة</span><span class="v">${ui.esc(trip.plate_no || '—')}</span></div>
        <div class="row"><span class="k">الحالة الحالية</span><span class="v">${ui.statusText(trip.status)}</span></div>
      </div>
      <form id="st-form">
        <div class="field">
          <label>الحالة الجديدة *</label>
          <select name="status" required>
            ${meta.statuses.map((s) => `<option value="${s}" ${trip.status === s ? 'selected' : ''}>${ui.statusText(s)}</option>`).join('')}
          </select>
          <div class="hint">عند اختيار "جارية" تُحجز المركبة، وعند "مكتملة" تُحرَّر وتُحدَّث قراءة العداد.</div>
        </div>
        <div class="field">
          <label>ملاحظات</label>
          <textarea name="notes" placeholder="أي ملاحظات على سير الرحلة"></textarea>
        </div>
      </form>`, {
      footer: '<button class="btn" form="st-form" type="submit">تحديث الحالة</button>',
    });

    modal.el.querySelector('#st-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const result = await api.post(`/trips/${trip.id}/status`, ui.formData(event.target));
        modal.close();
        ui.toast(result.message, 'success');
        App.refresh();
      } catch (error) { ui.fail(error); }
    });
  }

  global.PAGES.trips = {
    async render(container, App) {
      const canManage = App.hasRole('admin', 'operations');
      const isPrivileged = App.hasRole('admin', 'operations', 'manager', 'hr', 'finance');

      const filters = {
        status: App.params.status || '',
        q: App.params.q || '',
        driver_id: App.params.driver_id || '',
        scope: App.params.scope || '',
      };

      const requests = [
        api.get(`/trips${api.qs(filters)}`),
        api.get('/trips/meta'),
      ];
      if (isPrivileged) requests.push(api.get('/fleet'), api.get('/employees/lookup'));

      const [listResult, metaResult, fleetResult, lookupResult] = await Promise.all(requests);

      const trips = listResult.data;
      const meta = metaResult.data;
      const vehicles = fleetResult ? fleetResult.data : [];
      const drivers = lookupResult ? lookupResult.data : [];

      const counts = meta.statuses.reduce((acc, status) => {
        acc[status] = trips.filter((t) => t.status === status).length;
        return acc;
      }, {});

      const totalDistance = trips.reduce((sum, t) => sum + (Number(t.distance_km) || 0), 0);
      const totalWeight = trips.reduce((sum, t) => sum + (Number(t.weight_kg) || 0), 0);

      const columns = [
        { title: 'رمز الرحلة', render: (r) => `<b>${ui.esc(r.code)}</b>` },
        { title: 'المسار', cls: 'wrap', render: (r) => `${ui.esc(r.origin)} <span class="muted">←</span> ${ui.esc(r.destination)}` },
        { title: 'العميل', key: 'client_name' },
        { title: 'الشحنة', key: 'cargo' },
        { title: 'الوزن', cls: 'num', render: (r) => (r.weight_kg ? `${ui.number(r.weight_kg)} كجم` : '—') },
        { title: 'المسافة', cls: 'num', render: (r) => (r.distance_km ? `${ui.number(r.distance_km)} كم` : '—') },
        { title: 'المركبة', key: 'plate_no' },
        { title: 'السائق', render: (r) => (r.driver_name ? ui.esc(r.driver_name) : '<span class="muted">غير مسند</span>') },
        { title: 'الانطلاق', render: (r) => ui.dateTime(r.depart_at) },
        { title: 'التكلفة', cls: 'num', render: (r) => (r.cost ? ui.money(r.cost) : '—') },
        { title: 'الحالة', render: (r) => ui.status(r.status) },
        {
          title: 'إجراءات',
          render: (r) => {
            const buttons = [];
            const isDriver = r.driver_id === App.user.id;
            if (canManage || isDriver) {
              buttons.push(`<button class="btn sm" data-status="${r.id}">تحديث الحالة</button>`);
            }
            if (canManage) {
              buttons.push(`<button class="btn sm secondary" data-edit="${r.id}">تعديل</button>`);
              if (r.status !== 'in_progress') buttons.push(`<button class="btn sm danger" data-del="${r.id}">حذف</button>`);
            }
            return buttons.length ? `<div class="btn-row">${buttons.join('')}</div>` : '';
          },
        },
      ];

      container.innerHTML = `
        <div class="grid grid-4 mb-2">
          ${ui.stat('🚚', 'رحلات جارية', ui.number(counts.in_progress || 0), `مخططة ${ui.number(counts.planned || 0)}`, 'info')}
          ${ui.stat('✅', 'رحلات مكتملة', ui.number(counts.completed || 0), `متأخرة ${ui.number(counts.delayed || 0)}`, 'ok')}
          ${ui.stat('🛣️', 'إجمالي المسافة', `${ui.number(Math.round(totalDistance))} كم`, 'في الرحلات المعروضة')}
          ${ui.stat('📦', 'إجمالي الأوزان', `${ui.number(Math.round(totalWeight / 1000))} طن`, 'بضائع منقولة', 'accent')}
        </div>

        <div class="filters">
          <div class="field">
            <label>بحث</label>
            <input type="search" id="f-q" value="${ui.esc(filters.q)}" placeholder="رمز الرحلة، مدينة، عميل">
          </div>
          <div class="field">
            <label>الحالة</label>
            <select id="f-status">
              <option value="">كل الحالات</option>
              ${meta.statuses.map((s) => `<option value="${s}" ${filters.status === s ? 'selected' : ''}>${ui.statusText(s)}</option>`).join('')}
            </select>
          </div>
          ${isPrivileged ? `
            <div class="field">
              <label>السائق</label>
              <select id="f-driver">
                <option value="">كل السائقين</option>
                ${ui.options(drivers, 'id', 'full_name_ar', filters.driver_id)}
              </select>
            </div>
            <div class="field">
              <label>النطاق</label>
              <select id="f-scope">
                <option value="">كل الرحلات</option>
                <option value="mine" ${filters.scope === 'mine' ? 'selected' : ''}>رحلاتي فقط</option>
              </select>
            </div>` : ''}
          <button class="btn" id="apply">تصفية</button>
          ${canManage ? '<button class="btn accent" id="add">+ رحلة جديدة</button>' : ''}
        </div>

        <div class="card">
          <div class="card-head"><h3>الرحلات والشحنات</h3><div class="spacer"></div>
            <span class="muted small">${ui.number(trips.length)} رحلة</span></div>
          <div class="card-body tight">${ui.table(columns, trips, 'لا توجد رحلات مطابقة')}</div>
        </div>`;

      const applyFilters = () => App.go('trips', {
        q: container.querySelector('#f-q').value,
        status: container.querySelector('#f-status').value,
        driver_id: container.querySelector('#f-driver') ? container.querySelector('#f-driver').value : '',
        scope: container.querySelector('#f-scope') ? container.querySelector('#f-scope').value : '',
      });

      container.querySelector('#apply').addEventListener('click', applyFilters);
      container.querySelector('#f-status').addEventListener('change', applyFilters);
      ['#f-driver', '#f-scope'].forEach((selector) => {
        const el = container.querySelector(selector);
        if (el) el.addEventListener('change', applyFilters);
      });
      container.querySelector('#f-q').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') applyFilters();
      });

      const add = container.querySelector('#add');
      if (add) add.addEventListener('click', () => openForm(null, vehicles, drivers, meta, App));

      container.querySelectorAll('[data-edit]').forEach((button) => {
        button.addEventListener('click', () => {
          openForm(trips.find((t) => String(t.id) === button.dataset.edit), vehicles, drivers, meta, App);
        });
      });

      container.querySelectorAll('[data-status]').forEach((button) => {
        button.addEventListener('click', () => {
          statusDialog(trips.find((t) => String(t.id) === button.dataset.status), meta, App);
        });
      });

      container.querySelectorAll('[data-del]').forEach((button) => {
        button.addEventListener('click', async () => {
          const ok = await ui.confirm('حذف الرحلة', 'سيتم حذف الرحلة نهائياً.', 'حذف');
          if (!ok) return;
          try {
            const result = await api.del(`/trips/${button.dataset.del}`);
            ui.toast(result.message, 'success');
            App.refresh();
          } catch (error) { ui.fail(error); }
        });
      });
    },
  };
}(window));
