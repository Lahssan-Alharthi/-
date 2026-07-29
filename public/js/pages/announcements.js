/* الإعلانات الداخلية */
(function registerAnnouncements(global) {
  'use strict';

  global.PAGES = global.PAGES || {};

  const PRIORITIES = [['normal', 'عادي'], ['high', 'هام'], ['urgent', 'عاجل']];

  function priorityBadge(priority) {
    if (priority === 'urgent') return '<span class="badge danger">عاجل</span>';
    if (priority === 'high') return '<span class="badge warn">هام</span>';
    return '<span class="badge neutral">عادي</span>';
  }

  function openForm(announcement, departments, App) {
    const a = announcement || {};
    const modal = ui.modal(announcement ? 'تعديل الإعلان' : 'نشر إعلان جديد', `
      <form id="ann-form">
        <div class="field">
          <label>العنوان *</label>
          <input type="text" name="title" required value="${ui.esc(a.title || '')}">
        </div>
        <div class="field">
          <label>المحتوى *</label>
          <textarea name="body" required style="min-height:150px">${ui.esc(a.body || '')}</textarea>
        </div>
        <div class="form-grid">
          <div class="field">
            <label>الأولوية</label>
            <select name="priority">
              ${PRIORITIES.map(([v, l]) => `<option value="${v}" ${a.priority === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>موجّه إلى</label>
            <select name="department_id">
              <option value="">جميع الموظفين</option>
              ${ui.options(departments, 'id', 'name_ar', a.department_id)}
            </select>
          </div>
          <div class="field">
            <label>تاريخ انتهاء العرض</label>
            <input type="date" name="expires_at" value="${ui.esc((a.expires_at || '').slice(0, 10))}">
          </div>
          <div class="field">
            <label>&nbsp;</label>
            <label class="checkbox">
              <input type="checkbox" name="pinned" ${a.pinned ? 'checked' : ''}> تثبيت الإعلان في الأعلى
            </label>
          </div>
        </div>
      </form>`, {
      footer: `<button class="btn" form="ann-form" type="submit">${announcement ? 'حفظ التعديلات' : 'نشر الإعلان'}</button>`,
    });

    modal.el.querySelector('#ann-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const data = ui.formData(event.target);
        const result = announcement
          ? await api.put(`/announcements/${announcement.id}`, data)
          : await api.post('/announcements', data);
        modal.close();
        ui.toast(result.message, 'success');
        App.refresh();
      } catch (error) { ui.fail(error); }
    });
  }

  global.PAGES.announcements = {
    async render(container, App) {
      const canPublish = App.hasRole('admin', 'hr', 'operations', 'manager');

      const requests = [api.get('/announcements')];
      if (canPublish) requests.push(api.get('/departments'));

      const [listResult, deptResult] = await Promise.all(requests);
      const announcements = listResult.data;
      const departments = deptResult ? deptResult.data : [];

      const cards = announcements.length ? announcements.map((a) => `
        <div class="card">
          <div class="card-head">
            <h3>${a.pinned ? '📌 ' : ''}${ui.esc(a.title)}</h3>
            ${priorityBadge(a.priority)}
            ${a.department_name ? `<span class="badge brand">${ui.esc(a.department_name)}</span>` : '<span class="badge neutral">عام</span>'}
            <div class="spacer"></div>
            ${canPublish ? `
              <button class="btn sm secondary" data-edit="${a.id}">تعديل</button>
              ${App.hasRole('admin', 'hr') ? `<button class="btn sm danger" data-del="${a.id}">حذف</button>` : ''}` : ''}
          </div>
          <div class="card-body">
            <p style="white-space:pre-wrap">${ui.esc(a.body)}</p>
            <div class="small muted">
              نُشر بواسطة ${ui.esc(a.author_name || 'النظام')} — ${ui.ago(a.published_at)}
              ${a.expires_at ? ` — ينتهي عرضه في ${ui.dateShort(a.expires_at)}` : ''}
            </div>
          </div>
        </div>`).join('') : ui.empty('لا توجد إعلانات منشورة حالياً', '📢');

      container.innerHTML = `
        <div class="filters">
          <div class="spacer"></div>
          ${canPublish ? '<button class="btn accent" id="add">+ إعلان جديد</button>' : ''}
        </div>
        ${cards}`;

      const add = container.querySelector('#add');
      if (add) add.addEventListener('click', () => openForm(null, departments, App));

      container.querySelectorAll('[data-edit]').forEach((button) => {
        button.addEventListener('click', () => {
          openForm(announcements.find((a) => String(a.id) === button.dataset.edit), departments, App);
        });
      });

      container.querySelectorAll('[data-del]').forEach((button) => {
        button.addEventListener('click', async () => {
          const ok = await ui.confirm('حذف الإعلان', 'سيتم حذف الإعلان نهائياً.', 'حذف');
          if (!ok) return;
          try {
            const result = await api.del(`/announcements/${button.dataset.del}`);
            ui.toast(result.message, 'success');
            App.refresh();
          } catch (error) { ui.fail(error); }
        });
      });
    },
  };
}(window));
