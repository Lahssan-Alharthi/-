/* أدوات بناء الواجهة المشتركة */
(function attachUi(global) {
  'use strict';

  const ARABIC_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

  // أرقام لاتينية موحّدة عبر الواجهة لتتوافق مع التواريخ والأوقات في الجداول
  const LOCALE = 'ar-SA-u-nu-latn';

  // أدوات النسب التي تُتجاهل عند اختصار الاسم
  const NAME_PARTICLES = new Set(['بن', 'ابن', 'بنت']);

  function nameParts(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    const meaningful = parts.filter((part) => !NAME_PARTICLES.has(part));
    return meaningful.length ? meaningful : parts;
  }

  const STATUS_LABELS = {
    // عام
    pending: { text: 'قيد المعالجة', cls: 'warn' },
    approved: { text: 'معتمد', cls: 'ok' },
    rejected: { text: 'مرفوض', cls: 'danger' },
    cancelled: { text: 'ملغي', cls: 'neutral' },
    in_progress: { text: 'قيد التنفيذ', cls: 'info' },
    draft: { text: 'مسودة', cls: 'neutral' },
    // الموظفون
    active: { text: 'على رأس العمل', cls: 'ok' },
    suspended: { text: 'موقوف', cls: 'warn' },
    terminated: { text: 'منتهي الخدمة', cls: 'neutral' },
    // الحضور
    present: { text: 'حاضر', cls: 'ok' },
    late: { text: 'متأخر', cls: 'warn' },
    absent: { text: 'غائب', cls: 'danger' },
    leave: { text: 'إجازة', cls: 'info' },
    remote: { text: 'عن بُعد', cls: 'brand' },
    holiday: { text: 'عطلة', cls: 'neutral' },
    mission: { text: 'مهمة عمل', cls: 'brand' },
    // الأسطول
    available: { text: 'متاحة', cls: 'ok' },
    on_trip: { text: 'في رحلة', cls: 'info' },
    maintenance: { text: 'في الصيانة', cls: 'warn' },
    out_of_service: { text: 'خارج الخدمة', cls: 'danger' },
    // الرحلات
    planned: { text: 'مخططة', cls: 'neutral' },
    completed: { text: 'مكتملة', cls: 'ok' },
    delayed: { text: 'متأخرة', cls: 'warn' },
  };

  const ROLE_LABELS = {
    admin: 'مدير النظام',
    hr: 'الموارد البشرية',
    finance: 'الشؤون المالية',
    operations: 'إدارة العمليات',
    manager: 'مدير مباشر',
    employee: 'موظف',
  };

  const ui = {
    ARABIC_MONTHS,
    STATUS_LABELS,
    ROLE_LABELS,

    /** يهرّب النص قبل إدراجه في HTML. */
    esc(value) {
      if (value === null || value === undefined) return '';
      return String(value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    /** شارة حالة ملوّنة. */
    status(value) {
      const entry = STATUS_LABELS[value];
      if (!entry) return `<span class="badge neutral">${ui.esc(value || '—')}</span>`;
      return `<span class="badge ${entry.cls}">${entry.text}</span>`;
    },

    statusText(value) {
      return STATUS_LABELS[value] ? STATUS_LABELS[value].text : (value || '—');
    },

    role(value) {
      return ROLE_LABELS[value] || value || '—';
    },

    /** تنسيق تاريخ ميلادي بالعربية. */
    date(value) {
      if (!value) return '—';
      const iso = String(value).slice(0, 10);
      const parts = iso.split('-');
      if (parts.length !== 3) return ui.esc(value);
      return `${Number(parts[2])} ${ARABIC_MONTHS[Number(parts[1]) - 1]} ${parts[0]}`;
    },

    dateShort(value) {
      return value ? String(value).slice(0, 10) : '—';
    },

    dateTime(value) {
      if (!value) return '—';
      const text = String(value).replace('T', ' ');
      return `${ui.date(text.slice(0, 10))} — ${text.slice(11, 16)}`;
    },

    time(value) {
      return value ? String(value).slice(0, 5) : '—';
    },

    /** الوقت النسبي: "قبل 5 دقائق". */
    ago(value) {
      if (!value) return '';
      const stamp = Date.parse(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
      if (Number.isNaN(stamp)) return '';
      const diff = Math.floor((Date.now() - stamp) / 1000);
      if (diff < 60) return 'الآن';
      if (diff < 3600) return `قبل ${Math.floor(diff / 60)} دقيقة`;
      if (diff < 86400) return `قبل ${Math.floor(diff / 3600)} ساعة`;
      if (diff < 2592000) return `قبل ${Math.floor(diff / 86400)} يوم`;
      return ui.date(String(value).slice(0, 10));
    },

    /** مبلغ بالريال السعودي. */
    money(value) {
      const number = Number(value) || 0;
      return `${number.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`;
    },

    number(value) {
      return (Number(value) || 0).toLocaleString(LOCALE);
    },

    /** دقائق إلى "8 س 30 د". */
    duration(minutes) {
      const total = Math.max(0, Math.round(Number(minutes) || 0));
      const hours = Math.floor(total / 60);
      const mins = total % 60;
      if (!hours) return `${mins} د`;
      return mins ? `${hours} س ${mins} د` : `${hours} س`;
    },

    /** الأحرف الأولى من الاسم للصورة الرمزية. */
    initials(name) {
      const parts = nameParts(name);
      return (parts[0] || '؟').charAt(0) + (parts[1] ? parts[1].charAt(0) : '');
    },

    /** الاسم الأول واسم العائلة، بتجاهل أدوات النسب مثل "بن" و"بنت". */
    shortName(name) {
      const parts = nameParts(name);
      if (parts.length <= 2) return parts.join(' ');
      return `${parts[0]} ${parts[parts.length - 1]}`;
    },

    /** رسالة منبثقة. */
    toast(message, type) {
      const host = document.getElementById('toasts');
      const el = document.createElement('div');
      el.className = `toast ${type || ''}`;
      el.textContent = message;
      host.appendChild(el);
      setTimeout(() => {
        el.style.opacity = '0';
        el.style.transition = 'opacity .25s';
        setTimeout(() => el.remove(), 250);
      }, type === 'error' ? 5000 : 3200);
    },

    /** بطاقة مؤشر. */
    stat(icon, label, value, hint, tone) {
      return `
        <div class="stat ${tone || ''}">
          <div class="stat-icon">${icon}</div>
          <div>
            <div class="label">${ui.esc(label)}</div>
            <div class="value">${value}</div>
            ${hint ? `<div class="hint">${hint}</div>` : ''}
          </div>
        </div>`;
    },

    /** حالة فارغة. */
    empty(message, icon) {
      return `<div class="empty"><span class="icon">${icon || '📭'}</span>${ui.esc(message)}</div>`;
    },

    /**
     * جدول بيانات.
     * columns: [{ title, key, render(row), cls }]
     */
    table(columns, rows, emptyMessage) {
      if (!rows || !rows.length) return ui.empty(emptyMessage || 'لا توجد بيانات لعرضها');

      const head = columns.map((c) => `<th>${ui.esc(c.title)}</th>`).join('');
      const body = rows.map((row) => {
        const cells = columns.map((c) => {
          const content = c.render ? c.render(row) : ui.esc(row[c.key]);
          return `<td class="${c.cls || ''}">${content === undefined || content === null || content === '' ? '—' : content}</td>`;
        }).join('');
        return `<tr>${cells}</tr>`;
      }).join('');

      return `<div class="table-wrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
    },

    /** رسم أعمدة أفقية. */
    bars(items, options) {
      const list = items || [];
      if (!list.length) return ui.empty('لا توجد بيانات');
      const max = Math.max(...list.map((i) => Number(i.value) || 0), 1);
      const format = (options && options.format) || ((v) => ui.number(v));

      return `<div class="bars">${list.map((item) => `
        <div class="bar-row">
          <div class="bar-label" title="${ui.esc(item.label)}">${ui.esc(item.label)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${((Number(item.value) || 0) / max) * 100}%"></div></div>
          <div class="bar-value">${format(item.value)}</div>
        </div>`).join('')}</div>`;
    },

    /** رسم أعمدة رأسية مكدّسة للحضور. */
    attendanceChart(rows) {
      if (!rows || !rows.length) return ui.empty('لا توجد بيانات حضور');
      const max = Math.max(...rows.map((r) => (r.present || 0) + (r.late || 0) + (r.absent || 0)), 1);
      const scale = (value) => `${((Number(value) || 0) / max) * 140}px`;

      const cols = rows.map((row) => `
        <div class="col" title="${ui.esc(row.label)}: حاضر ${row.present || 0} / متأخر ${row.late || 0} / غائب ${row.absent || 0}">
          <div class="seg absent"  style="height:${scale(row.absent)}"></div>
          <div class="seg late"    style="height:${scale(row.late)}"></div>
          <div class="seg present" style="height:${scale(row.present)}"></div>
          <div class="col-label">${String(row.label).slice(8)}</div>
        </div>`).join('');

      return `
        <div class="chart-columns">${cols}</div>
        <div class="legend">
          <span><i style="background:var(--brand)"></i> حاضر</span>
          <span><i style="background:var(--accent)"></i> متأخر</span>
          <span><i style="background:#ef8f8f"></i> غائب</span>
        </div>`;
    },

    /** حلقة تقدّم دائرية. */
    ring(percent, label, sublabel) {
      const value = Math.max(0, Math.min(100, Number(percent) || 0));
      const radius = 34;
      const circumference = 2 * Math.PI * radius;
      const offset = circumference * (1 - value / 100);

      return `
        <div class="progress-ring">
          <svg width="86" height="86" viewBox="0 0 86 86">
            <circle cx="43" cy="43" r="${radius}" fill="none" stroke="#eef1f5" stroke-width="9"></circle>
            <circle cx="43" cy="43" r="${radius}" fill="none" stroke="var(--brand)" stroke-width="9"
                    stroke-linecap="round" stroke-dasharray="${circumference}"
                    stroke-dashoffset="${offset}" transform="rotate(-90 43 43)"></circle>
            <text x="43" y="48" text-anchor="middle" font-size="17" font-weight="700" fill="#1a2331">${Math.round(value)}%</text>
          </svg>
          <div>
            <div style="font-weight:700">${label}</div>
            <div class="small muted">${sublabel || ''}</div>
          </div>
        </div>`;
    },

    /** خيارات قائمة منسدلة. */
    options(items, valueKey, labelKey, selected) {
      return (items || []).map((item) => {
        const value = item[valueKey];
        const label = item[labelKey];
        return `<option value="${ui.esc(value)}" ${String(selected) === String(value) ? 'selected' : ''}>${ui.esc(label)}</option>`;
      }).join('');
    },

    /**
     * نافذة منبثقة. content يمكن أن يكون HTML نصياً.
     * تعيد كائناً فيه العنصر ودالة الإغلاق.
     */
    modal(title, content, options) {
      const config = options || {};
      const root = document.getElementById('modal-root');

      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML = `
        <div class="modal ${config.wide ? 'wide' : ''}" role="dialog" aria-modal="true">
          <div class="modal-head">
            <h3>${ui.esc(title)}</h3>
            <button class="close-x" type="button" aria-label="إغلاق">&times;</button>
          </div>
          <div class="modal-body">${content}</div>
          ${config.footer === null ? '' : `<div class="modal-foot">${config.footer || ''}</div>`}
        </div>`;

      const close = () => {
        backdrop.remove();
        document.removeEventListener('keydown', onKey);
      };
      // عند تكدّس النوافذ يغلق زر Escape النافذة العلوية وحدها
      function onKey(event) {
        if (event.key !== 'Escape') return;
        if (root.lastElementChild !== backdrop) return;
        close();
      }

      backdrop.querySelector('.close-x').addEventListener('click', close);
      backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
      document.addEventListener('keydown', onKey);

      root.appendChild(backdrop);
      const first = backdrop.querySelector('input, select, textarea');
      if (first) first.focus();

      return { el: backdrop, close };
    },

    /** تأكيد إجراء. يعيد Promise<boolean>. */
    confirm(title, message, confirmLabel, tone) {
      return new Promise((resolve) => {
        const modal = ui.modal(title, `<p class="mb-0">${ui.esc(message)}</p>`, {
          footer: `
            <button class="btn ${tone || 'danger'}" data-yes>${ui.esc(confirmLabel || 'تأكيد')}</button>
            <button class="btn secondary" data-no>إلغاء</button>`,
        });

        modal.el.querySelector('[data-yes]').addEventListener('click', () => { modal.close(); resolve(true); });
        modal.el.querySelector('[data-no]').addEventListener('click', () => { modal.close(); resolve(false); });
      });
    },

    /** يجمع قيم نموذج في كائن. */
    formData(form) {
      const data = {};
      new FormData(form).forEach((value, key) => { data[key] = value; });
      form.querySelectorAll('input[type=checkbox]').forEach((box) => {
        data[box.name] = box.checked;
      });
      return data;
    },

    /** يعالج خطأ ويعرضه للمستخدم. */
    fail(error) {
      ui.toast(error && error.message ? error.message : 'حدث خطأ غير متوقع', 'error');
    },
  };

  global.ui = ui;
}(window));
