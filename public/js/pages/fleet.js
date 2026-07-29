/* إدارة الأسطول */
(function registerFleet(global) {
  'use strict';

  global.PAGES = global.PAGES || {};

  function openForm(vehicle, meta, drivers, App) {
    const v = vehicle || {};
    const modal = ui.modal(vehicle ? `تعديل المركبة ${v.plate_no}` : 'إضافة مركبة', `
      <form id="veh-form">
        <div class="form-grid">
          <div class="field">
            <label>رقم اللوحة *</label>
            <input type="text" name="plate_no" required value="${ui.esc(v.plate_no || '')}">
          </div>
          <div class="field">
            <label>النوع</label>
            <select name="type">
              ${meta.types.map((t) => `<option value="${ui.esc(t)}" ${v.type === t ? 'selected' : ''}>${ui.esc(t)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>الماركة والموديل</label>
            <input type="text" name="make_model" value="${ui.esc(v.make_model || '')}">
          </div>
          <div class="field">
            <label>سنة الصنع</label>
            <input type="number" name="year" min="1980" max="2100" value="${v.year || ''}">
          </div>
          <div class="field">
            <label>الحمولة (كجم)</label>
            <input type="number" name="capacity_kg" min="0" step="10" value="${v.capacity_kg || ''}">
          </div>
          <div class="field">
            <label>قراءة العداد (كم)</label>
            <input type="number" name="odometer_km" min="0" step="1" value="${v.odometer_km || 0}">
          </div>
          <div class="field">
            <label>الحالة</label>
            <select name="status">
              ${meta.statuses.map((s) => `<option value="${s}" ${v.status === s ? 'selected' : ''}>${ui.statusText(s)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>السائق المسؤول</label>
            <select name="driver_id">
              <option value="">— بدون —</option>
              ${ui.options(drivers, 'id', 'full_name_ar', v.driver_id)}
            </select>
          </div>
          <div class="field">
            <label>آخر صيانة</label>
            <input type="date" name="last_maintenance" value="${ui.esc((v.last_maintenance || '').slice(0, 10))}">
          </div>
          <div class="field">
            <label>الصيانة القادمة</label>
            <input type="date" name="next_maintenance" value="${ui.esc((v.next_maintenance || '').slice(0, 10))}">
          </div>
          <div class="field">
            <label>انتهاء التأمين</label>
            <input type="date" name="insurance_expiry" value="${ui.esc((v.insurance_expiry || '').slice(0, 10))}">
          </div>
          <div class="field">
            <label>انتهاء الاستمارة</label>
            <input type="date" name="registration_expiry" value="${ui.esc((v.registration_expiry || '').slice(0, 10))}">
          </div>
          <div class="field full">
            <label>ملاحظات</label>
            <textarea name="notes">${ui.esc(v.notes || '')}</textarea>
          </div>
        </div>
      </form>`, {
      wide: true,
      footer: '<button class="btn" form="veh-form" type="submit">حفظ</button>',
    });

    modal.el.querySelector('#veh-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const data = ui.formData(event.target);
        const result = vehicle
          ? await api.put(`/fleet/${vehicle.id}`, data)
          : await api.post('/fleet', data);
        modal.close();
        ui.toast(result.message, 'success');
        App.refresh();
      } catch (error) { ui.fail(error); }
    });
  }

  function maintenanceDialog(vehicle, meta, App) {
    const modal = ui.modal(`تسجيل صيانة — ${vehicle.plate_no}`, `
      <form id="mnt-form">
        <div class="form-grid">
          <div class="field">
            <label>تاريخ الصيانة</label>
            <input type="date" name="date" value="${new Date().toISOString().slice(0, 10)}">
          </div>
          <div class="field">
            <label>موعد الصيانة القادمة</label>
            <input type="date" name="next_maintenance">
          </div>
          <div class="field">
            <label>قراءة العداد (كم)</label>
            <input type="number" name="odometer_km" min="0" value="${vehicle.odometer_km || 0}">
          </div>
          <div class="field">
            <label>حالة المركبة بعد الصيانة</label>
            <select name="status">
              ${meta.statuses.map((s) => `<option value="${s}" ${vehicle.status === s ? 'selected' : ''}>${ui.statusText(s)}</option>`).join('')}
            </select>
          </div>
          <div class="field full">
            <label>تفاصيل الصيانة</label>
            <textarea name="notes" placeholder="الأعمال التي تمت وقطع الغيار المستبدلة"></textarea>
          </div>
        </div>
      </form>`, {
      footer: '<button class="btn" form="mnt-form" type="submit">حفظ</button>',
    });

    modal.el.querySelector('#mnt-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const result = await api.post(`/fleet/${vehicle.id}/maintenance`, ui.formData(event.target));
        modal.close();
        ui.toast(result.message, 'success');
        App.refresh();
      } catch (error) { ui.fail(error); }
    });
  }

  /** يبرز التواريخ المنتهية أو القريبة من الانتهاء. */
  function expiryCell(value) {
    if (!value) return '—';
    const days = Math.floor((Date.parse(value) - Date.now()) / 86400000);
    if (days < 0) return `<span class="badge danger">${ui.dateShort(value)} — منتهٍ</span>`;
    if (days <= 30) return `<span class="badge warn">${ui.dateShort(value)} — ${days} يوم</span>`;
    return ui.dateShort(value);
  }

  global.PAGES.fleet = {
    async render(container, App) {
      const canManage = App.hasRole('admin', 'operations');
      const filters = { status: App.params.status || '', type: App.params.type || '', q: App.params.q || '' };

      const [listResult, metaResult, lookupResult, alertsResult] = await Promise.all([
        api.get(`/fleet${api.qs(filters)}`),
        api.get('/fleet/meta'),
        api.get('/employees/lookup'),
        api.get('/fleet/alerts/due?days=45'),
      ]);

      const vehicles = listResult.data;
      const meta = metaResult.data;
      const drivers = lookupResult.data;

      const counts = meta.statuses.reduce((acc, status) => {
        acc[status] = vehicles.filter((v) => v.status === status).length;
        return acc;
      }, {});

      const columns = [
        { title: 'رقم اللوحة', render: (r) => `<b>${ui.esc(r.plate_no)}</b>` },
        { title: 'النوع', key: 'type' },
        { title: 'الماركة والموديل', key: 'make_model' },
        { title: 'سنة الصنع', cls: 'num', key: 'year' },
        { title: 'الحمولة', cls: 'num', render: (r) => (r.capacity_kg ? `${ui.number(r.capacity_kg)} كجم` : '—') },
        { title: 'السائق', render: (r) => (r.driver_name ? `<a href="#/profile?id=${r.driver_id}">${ui.esc(r.driver_name)}</a>` : '<span class="muted">غير مسند</span>') },
        { title: 'العداد', cls: 'num', render: (r) => `${ui.number(Math.round(r.odometer_km))} كم` },
        { title: 'الصيانة القادمة', render: (r) => expiryCell(r.next_maintenance) },
        { title: 'التأمين', render: (r) => expiryCell(r.insurance_expiry) },
        { title: 'الاستمارة', render: (r) => expiryCell(r.registration_expiry) },
        { title: 'الحالة', render: (r) => ui.status(r.status) },
      ];

      if (canManage) {
        columns.push({
          title: 'إجراءات',
          render: (r) => `
            <div class="btn-row">
              <button class="btn sm secondary" data-edit="${r.id}">تعديل</button>
              <button class="btn sm secondary" data-mnt="${r.id}">صيانة</button>
              <button class="btn sm danger" data-del="${r.id}">حذف</button>
            </div>`,
        });
      }

      container.innerHTML = `
        <div class="grid grid-4 mb-2">
          ${ui.stat('🛻', 'إجمالي المركبات', ui.number(vehicles.length), 'في الأسطول')}
          ${ui.stat('✅', 'متاحة', ui.number(counts.available || 0), 'جاهزة للتشغيل', 'ok')}
          ${ui.stat('🚚', 'في رحلة', ui.number(counts.on_trip || 0), 'قيد التشغيل', 'info')}
          ${ui.stat('🔧', 'صيانة / خارج الخدمة', ui.number((counts.maintenance || 0) + (counts.out_of_service || 0)), '', 'warn')}
        </div>

        ${alertsResult.data.length ? `
          <div class="card">
            <div class="card-head"><h3>⚠️ تنبيهات الوثائق والصيانة</h3><div class="spacer"></div>
              <span class="badge warn">${ui.number(alertsResult.data.length)} مركبة تحتاج متابعة</span></div>
            <div class="card-body tight">
              ${ui.table([
    { title: 'اللوحة', key: 'plate_no' },
    { title: 'النوع', key: 'type' },
    { title: 'التأمين', render: (r) => expiryCell(r.insurance_expiry) },
    { title: 'الاستمارة', render: (r) => expiryCell(r.registration_expiry) },
    { title: 'الصيانة القادمة', render: (r) => expiryCell(r.next_maintenance) },
  ], alertsResult.data)}
            </div>
          </div>` : ''}

        <div class="filters">
          <div class="field">
            <label>بحث</label>
            <input type="search" id="f-q" value="${ui.esc(filters.q)}" placeholder="رقم اللوحة أو الموديل">
          </div>
          <div class="field">
            <label>النوع</label>
            <select id="f-type">
              <option value="">كل الأنواع</option>
              ${meta.types.map((t) => `<option value="${ui.esc(t)}" ${filters.type === t ? 'selected' : ''}>${ui.esc(t)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>الحالة</label>
            <select id="f-status">
              <option value="">كل الحالات</option>
              ${meta.statuses.map((s) => `<option value="${s}" ${filters.status === s ? 'selected' : ''}>${ui.statusText(s)}</option>`).join('')}
            </select>
          </div>
          <button class="btn" id="apply">تصفية</button>
          ${canManage ? '<button class="btn accent" id="add">+ إضافة مركبة</button>' : ''}
        </div>

        <div class="card">
          <div class="card-head"><h3>مركبات الأسطول</h3></div>
          <div class="card-body tight">${ui.table(columns, vehicles, 'لا توجد مركبات')}</div>
        </div>`;

      const applyFilters = () => App.go('fleet', {
        q: container.querySelector('#f-q').value,
        type: container.querySelector('#f-type').value,
        status: container.querySelector('#f-status').value,
      });
      container.querySelector('#apply').addEventListener('click', applyFilters);
      ['#f-type', '#f-status'].forEach((s) => container.querySelector(s).addEventListener('change', applyFilters));

      const add = container.querySelector('#add');
      if (add) add.addEventListener('click', () => openForm(null, meta, drivers, App));

      container.querySelectorAll('[data-edit]').forEach((button) => {
        button.addEventListener('click', () => {
          openForm(vehicles.find((v) => String(v.id) === button.dataset.edit), meta, drivers, App);
        });
      });

      container.querySelectorAll('[data-mnt]').forEach((button) => {
        button.addEventListener('click', () => {
          maintenanceDialog(vehicles.find((v) => String(v.id) === button.dataset.mnt), meta, App);
        });
      });

      container.querySelectorAll('[data-del]').forEach((button) => {
        button.addEventListener('click', async () => {
          const ok = await ui.confirm('حذف المركبة', 'سيتم حذف المركبة نهائياً من الأسطول.', 'حذف');
          if (!ok) return;
          try {
            const result = await api.del(`/fleet/${button.dataset.del}`);
            ui.toast(result.message, 'success');
            App.refresh();
          } catch (error) { ui.fail(error); }
        });
      });
    },
  };
}(window));
