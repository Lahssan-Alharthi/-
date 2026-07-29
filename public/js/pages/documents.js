/* المستندات */
(function registerDocuments(global) {
  'use strict';

  global.PAGES = global.PAGES || {};

  function formatSize(bytes) {
    const size = Number(bytes) || 0;
    if (size < 1024) return `${size} بايت`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} كيلوبايت`;
    return `${(size / 1024 / 1024).toFixed(2)} ميجابايت`;
  }

  function uploadDialog(categories, employees, App) {
    const canPublish = App.hasRole('admin', 'hr');

    const modal = ui.modal('رفع مستند', `
      <form id="doc-form">
        <div class="field">
          <label>الملف *</label>
          <input type="file" name="file" required>
          <div class="hint">المسموح: PDF، صور، Word، Excel، نصوص — بحد أقصى 8 ميجابايت.</div>
        </div>
        <div class="field">
          <label>عنوان المستند</label>
          <input type="text" name="title" placeholder="يُستخدم اسم الملف إن ترك فارغاً">
        </div>
        <div class="form-grid">
          <div class="field">
            <label>التصنيف</label>
            <select name="category">
              ${categories.map((c) => `<option value="${ui.esc(c)}">${ui.esc(c)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>تاريخ انتهاء الصلاحية</label>
            <input type="date" name="expires_at">
          </div>
          ${canPublish ? `
            <div class="field">
              <label>مستند خاص بالموظف</label>
              <select name="employee_id">
                <option value="">— أنا —</option>
                ${ui.options(employees, 'id', 'full_name_ar')}
              </select>
            </div>
            <div class="field">
              <label>مستوى الظهور</label>
              <select name="visibility">
                <option value="private">خاص</option>
                <option value="public">عام لجميع الموظفين</option>
              </select>
            </div>` : ''}
        </div>
      </form>`, {
      footer: '<button class="btn" form="doc-form" type="submit">رفع المستند</button>',
    });

    modal.el.querySelector('#doc-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = modal.el.querySelector('button[type=submit]');
      button.disabled = true;
      button.textContent = 'جارٍ الرفع…';

      try {
        const response = await fetch('/api/documents', {
          method: 'POST',
          credentials: 'same-origin',
          body: new FormData(event.target),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'تعذّر رفع المستند');

        modal.close();
        ui.toast(payload.message, 'success');
        App.refresh();
      } catch (error) {
        ui.fail(error);
        button.disabled = false;
        button.textContent = 'رفع المستند';
      }
    });
  }

  global.PAGES.documents = {
    async render(container, App) {
      const isHr = App.hasRole('admin', 'hr');
      const category = App.params.category || '';
      const q = App.params.q || '';

      const requests = [
        api.get(`/documents${api.qs({ category, q, employee_id: App.params.employee_id })}`),
        api.get('/documents/categories'),
      ];
      if (isHr) requests.push(api.get('/employees/lookup'), api.get('/documents/alerts/expiring?days=60'));

      const [listResult, categoriesResult, lookupResult, expiringResult] = await Promise.all(requests);
      const documents = listResult.data;
      const categories = categoriesResult.data;

      const columns = [
        { title: 'العنوان', key: 'title', cls: 'wrap' },
        { title: 'التصنيف', render: (r) => `<span class="badge brand">${ui.esc(r.category)}</span>` },
        { title: 'الملف', render: (r) => `<span class="small muted">${ui.esc(r.file_name)}</span>` },
        { title: 'الحجم', render: (r) => formatSize(r.size_bytes) },
        { title: 'الظهور', render: (r) => (r.visibility === 'public' ? '<span class="badge info">عام</span>' : '<span class="badge neutral">خاص</span>') },
        ...(isHr ? [{ title: 'يخص الموظف', render: (r) => ui.esc(r.employee_name || '—') }] : []),
        { title: 'رفعه', key: 'uploaded_by_name' },
        { title: 'تاريخ الرفع', render: (r) => ui.dateShort(r.created_at) },
        { title: 'انتهاء الصلاحية', render: (r) => (r.expires_at ? ui.dateShort(r.expires_at) : '—') },
        {
          title: 'إجراءات',
          render: (r) => `
            <div class="btn-row">
              <button class="btn sm secondary" data-download="${r.id}">تنزيل</button>
              <button class="btn sm danger" data-del="${r.id}">حذف</button>
            </div>`,
        },
      ];

      const byCategory = categories.map((c) => ({
        label: c,
        value: documents.filter((d) => d.category === c).length,
      })).filter((item) => item.value > 0);

      container.innerHTML = `
        <div class="grid grid-4 mb-2">
          ${ui.stat('📁', 'إجمالي المستندات', ui.number(documents.length), 'المتاحة لك')}
          ${ui.stat('🌐', 'مستندات عامة', ui.number(documents.filter((d) => d.visibility === 'public').length), 'سياسات ونماذج', 'info')}
          ${ui.stat('🔒', 'مستنداتي الخاصة', ui.number(documents.filter((d) => d.visibility === 'private').length), '', 'ok')}
          ${ui.stat('⚠️', 'تقارب الانتهاء', ui.number(expiringResult ? expiringResult.data.length : 0), 'خلال 60 يوماً', 'warn')}
        </div>

        <div class="filters">
          <div class="field">
            <label>بحث</label>
            <input type="search" id="f-q" value="${ui.esc(q)}" placeholder="عنوان المستند">
          </div>
          <div class="field">
            <label>التصنيف</label>
            <select id="f-cat">
              <option value="">كل التصنيفات</option>
              ${categories.map((c) => `<option value="${ui.esc(c)}" ${category === c ? 'selected' : ''}>${ui.esc(c)}</option>`).join('')}
            </select>
          </div>
          <button class="btn" id="apply">تصفية</button>
          <button class="btn accent" id="upload">+ رفع مستند</button>
        </div>

        <div class="card">
          <div class="card-head"><h3>المستندات</h3></div>
          <div class="card-body tight">${ui.table(columns, documents, 'لا توجد مستندات')}</div>
        </div>

        ${byCategory.length ? `
          <div class="card">
            <div class="card-head"><h3>التوزيع حسب التصنيف</h3></div>
            <div class="card-body">${ui.bars(byCategory)}</div>
          </div>` : ''}`;

      container.querySelector('#upload').addEventListener('click', () => uploadDialog(
        categories, lookupResult ? lookupResult.data : [], App,
      ));

      const applyFilters = () => App.go('documents', {
        q: container.querySelector('#f-q').value,
        category: container.querySelector('#f-cat').value,
      });
      container.querySelector('#apply').addEventListener('click', applyFilters);
      container.querySelector('#f-cat').addEventListener('change', applyFilters);
      container.querySelector('#f-q').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') applyFilters();
      });

      container.querySelectorAll('[data-download]').forEach((button) => {
        button.addEventListener('click', () => api.download(`/documents/${button.dataset.download}/download`));
      });

      container.querySelectorAll('[data-del]').forEach((button) => {
        button.addEventListener('click', async () => {
          const ok = await ui.confirm('حذف المستند', 'سيتم حذف الملف نهائياً من الخادم.', 'حذف');
          if (!ok) return;
          try {
            const result = await api.del(`/documents/${button.dataset.del}`);
            ui.toast(result.message, 'success');
            App.refresh();
          } catch (error) { ui.fail(error); }
        });
      });
    },
  };
}(window));
