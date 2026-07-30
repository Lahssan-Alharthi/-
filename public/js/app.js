/* نواة التطبيق: الجلسة، التخطيط، التنقّل */
(function bootstrap(global) {
  'use strict';

  const PAGES = global.PAGES || {};

  const NAV = [
    { group: 'عام', items: [
      { route: 'dashboard', label: 'لوحة التحكم', icon: '🏠' },
      { route: 'announcements', label: 'الإعلانات', icon: '📢' },
      { route: 'profile', label: 'ملفي الشخصي', icon: '👤' },
    ] },
    { group: 'خدماتي', items: [
      { route: 'attendance', label: 'الحضور والانصراف', icon: '🕒' },
      { route: 'leaves', label: 'الإجازات', icon: '🌴' },
      { route: 'requests', label: 'طلبات الخدمات', icon: '📝' },
      { route: 'payroll', label: 'الرواتب', icon: '💰' },
      { route: 'settlements', label: 'السلف والمخالصات', icon: '🧾' },
      { route: 'documents', label: 'المستندات', icon: '📁' },
    ] },
    { group: 'العمليات اللوجستية', items: [
      { route: 'trips', label: 'الرحلات والشحنات', icon: '🚚' },
      { route: 'fleet', label: 'الأسطول', icon: '🛻', roles: ['admin', 'operations', 'manager', 'finance', 'hr'] },
    ] },
    { group: 'الإدارة', items: [
      { route: 'employees', label: 'الموظفون', icon: '👥', roles: ['admin', 'hr', 'finance', 'operations', 'manager'] },
      { route: 'departments', label: 'الأقسام', icon: '🏢', roles: ['admin', 'hr', 'finance', 'operations', 'manager'] },
      { route: 'reports', label: 'التقارير', icon: '📊', roles: ['admin', 'hr', 'finance', 'operations', 'manager'] },
      { route: 'admin', label: 'إعدادات النظام', icon: '⚙️', roles: ['admin'] },
    ] },
  ];

  const PAGE_TITLES = {
    dashboard: 'لوحة التحكم',
    announcements: 'الإعلانات الداخلية',
    profile: 'ملفي الشخصي',
    attendance: 'الحضور والانصراف',
    leaves: 'الإجازات',
    requests: 'طلبات الخدمات',
    payroll: 'الرواتب وإشعارات الراتب',
    settlements: 'السلف ومخالصات نهاية الخدمة',
    documents: 'المستندات',
    trips: 'الرحلات والشحنات',
    fleet: 'إدارة الأسطول',
    employees: 'شؤون الموظفين',
    departments: 'الأقسام والهيكل التنظيمي',
    reports: 'التقارير',
    admin: 'إعدادات النظام',
  };

  const App = {
    user: null,
    settings: {},
    route: 'dashboard',
    params: {},

    /** يعيد true إذا كان دور المستخدم ضمن القائمة. */
    hasRole(...roles) {
      return Boolean(App.user && roles.flat().includes(App.user.role));
    },

    /** الانتقال إلى مسار. */
    go(route, params) {
      const query = params && Object.keys(params).length
        ? `?${new URLSearchParams(params).toString()}`
        : '';
      global.location.hash = `#/${route}${query}`;
    },

    /** إعادة رسم الصفحة الحالية. */
    async refresh() {
      await renderRoute();
    },
  };

  // ---------------------------------------------------------------- الدخول

  const DEMO_ACCOUNTS = [
    ['admin@madad.com.sa', 'مدير النظام'],
    ['hr@madad.com.sa', 'الموارد البشرية'],
    ['finance@madad.com.sa', 'الشؤون المالية'],
    ['ops@madad.com.sa', 'إدارة العمليات'],
    ['m.alanazi@madad.com.sa', 'موظف (سائق)'],
  ];

  function renderLogin(message) {
    const app = document.getElementById('app');
    app.className = '';
    app.innerHTML = `
      <div class="login-page">
        <div class="login-hero">
          <div class="badge-logo">مدد</div>
          <h1>بوابة الموظفين</h1>
          <p class="tagline">منصة شركة مدد للخدمات اللوجستية لإدارة شؤون الموظفين والعمليات في مكان واحد.</p>
          <div class="login-features">
            <div><span class="dot"></span> تسجيل الحضور والانصراف إلكترونياً</div>
            <div><span class="dot"></span> طلبات الإجازات والخدمات واعتمادها</div>
            <div><span class="dot"></span> إشعارات الرواتب والمستندات الوظيفية</div>
            <div><span class="dot"></span> متابعة الأسطول والرحلات والشحنات</div>
          </div>
        </div>

        <div class="login-panel">
          <h2>تسجيل الدخول</h2>
          <p class="sub">أدخل بيانات حسابك الوظيفي للمتابعة</p>

          <form id="login-form">
            <div class="field">
              <label for="email">البريد الإلكتروني</label>
              <input type="email" id="email" name="email" required autocomplete="username"
                     placeholder="name@madad.com.sa">
            </div>
            <div class="field">
              <label for="password">كلمة المرور</label>
              <input type="password" id="password" name="password" required autocomplete="current-password"
                     placeholder="••••••••">
            </div>
            <div id="login-error" class="badge danger ${message ? '' : 'hidden'}" style="display:block;margin-bottom:.8rem">${ui.esc(message || '')}</div>
            <button class="btn block" type="submit" id="login-btn">دخول</button>
          </form>

          <div class="demo-accounts">
            <b>حسابات تجريبية (كلمة المرور: Madad@2026)</b>
            ${DEMO_ACCOUNTS.map(([email, role]) => `
              <div><button type="button" data-email="${email}">${email}</button> <span class="muted">— ${role}</span></div>
            `).join('')}
          </div>
        </div>
      </div>`;

    app.querySelectorAll('[data-email]').forEach((button) => {
      button.addEventListener('click', () => {
        app.querySelector('#email').value = button.dataset.email;
        app.querySelector('#password').value = 'Madad@2026';
        app.querySelector('#password').focus();
      });
    });

    app.querySelector('#login-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = app.querySelector('#login-btn');
      const errorBox = app.querySelector('#login-error');

      button.disabled = true;
      button.textContent = 'جارٍ التحقق…';
      errorBox.classList.add('hidden');

      try {
        const result = await api.post('/auth/login', {
          email: app.querySelector('#email').value.trim(),
          password: app.querySelector('#password').value,
        });
        App.user = result.user;
        await startApp();
      } catch (error) {
        errorBox.textContent = error.message;
        errorBox.classList.remove('hidden');
        button.disabled = false;
        button.textContent = 'دخول';
      }
    });
  }

  // ---------------------------------------------------------------- التخطيط

  function navHtml() {
    return NAV.map((group) => {
      const items = group.items.filter((item) => !item.roles || App.hasRole(item.roles));
      if (!items.length) return '';
      return `
        <div class="nav-group-title">${group.group}</div>
        ${items.map((item) => `
          <a href="#/${item.route}" data-route="${item.route}">
            <span class="icon">${item.icon}</span>
            <span>${item.label}</span>
            <span class="count hidden" data-count="${item.route}"></span>
          </a>`).join('')}`;
    }).join('');
  }

  function renderLayout() {
    const app = document.getElementById('app');
    app.className = '';
    app.innerHTML = `
      <div class="layout">
        <aside class="sidebar" id="sidebar">
          <div class="sidebar-brand">
            <div class="mark">مدد</div>
            <div>
              <div class="name">بوابة الموظفين</div>
              <div class="sub">شركة مدد للخدمات اللوجستية</div>
            </div>
          </div>
          <nav class="nav" id="nav">${navHtml()}</nav>
        </aside>

        <div class="main">
          <header class="topbar">
            <button class="icon-btn menu-toggle" id="menu-toggle" aria-label="القائمة">☰</button>
            <div class="page-title" id="page-title">لوحة التحكم</div>
            <div class="spacer"></div>
            <div class="clock" id="clock"></div>
            <button class="icon-btn" id="notif-btn" aria-label="الإشعارات">🔔
              <span class="dot-badge hidden" id="notif-count">0</span>
            </button>
            <div class="user-chip" id="user-chip">
              <div class="avatar">${ui.initials(App.user.full_name_ar)}</div>
              <div class="meta">
                <div class="name">${ui.esc(App.user.full_name_ar)}</div>
                <div class="role">${ui.esc(App.user.role_label || ui.role(App.user.role))}</div>
              </div>
            </div>
          </header>

          <main class="content" id="content"></main>
        </div>
      </div>`;

    document.getElementById('menu-toggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });

    document.getElementById('nav').addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('open');
    });

    document.getElementById('notif-btn').addEventListener('click', toggleNotifications);
    document.getElementById('user-chip').addEventListener('click', showUserMenu);

    startClock();
  }

  function startClock() {
    const el = document.getElementById('clock');
    const tick = () => {
      const now = new Date();
      const date = now.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      });
      el.textContent = `${date} — ${now.toTimeString().slice(0, 5)}`;
    };
    tick();
    clearInterval(global.__clockTimer);
    global.__clockTimer = setInterval(tick, 20000);
  }

  function showUserMenu() {
    const existing = document.querySelector('.dropdown[data-user-menu]');
    if (existing) { existing.remove(); return; }
    closeDropdowns();

    const menu = document.createElement('div');
    menu.className = 'dropdown';
    menu.dataset.userMenu = '1';
    menu.innerHTML = `
      <div class="dropdown-head">
        <div class="avatar">${ui.initials(App.user.full_name_ar)}</div>
        <div>
          <div>${ui.esc(App.user.full_name_ar)}</div>
          <div class="small muted">${ui.esc(App.user.job_title || '')}</div>
        </div>
      </div>
      <div class="dropdown-list">
        <div class="notif-item" data-action="profile"><span>👤</span> ملفي الشخصي</div>
        <div class="notif-item" data-action="password"><span>🔑</span> تغيير كلمة المرور</div>
        <div class="notif-item" data-action="logout"><span>🚪</span> تسجيل الخروج</div>
      </div>`;

    document.querySelector('.main').appendChild(menu);

    menu.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-action]');
      if (!action) return;
      menu.remove();

      if (action.dataset.action === 'profile') App.go('profile');
      if (action.dataset.action === 'password') changePasswordDialog();
      if (action.dataset.action === 'logout') {
        await api.post('/auth/logout');
        App.user = null;
        clearInterval(global.__notifTimer);
        renderLogin('تم تسجيل الخروج بنجاح');
      }
    });
  }

  function closeDropdowns() {
    document.querySelectorAll('.dropdown').forEach((el) => el.remove());
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('.dropdown') || event.target.closest('#notif-btn')
        || event.target.closest('#user-chip')) return;
    closeDropdowns();
  });

  /** نافذة تغيير كلمة المرور. */
  function changePasswordDialog(forced) {
    const modal = ui.modal('تغيير كلمة المرور', `
      <form id="pw-form">
        ${forced ? '<p class="badge warn" style="display:block;margin-bottom:1rem">لأسباب أمنية يجب تغيير كلمة المرور المؤقتة قبل المتابعة.</p>' : ''}
        <div class="field">
          <label>كلمة المرور الحالية</label>
          <input type="password" name="current_password" required autocomplete="current-password">
        </div>
        <div class="field">
          <label>كلمة المرور الجديدة</label>
          <input type="password" name="new_password" required autocomplete="new-password">
          <div class="hint">8 أحرف على الأقل، وتحتوي على حرف ورقم.</div>
        </div>
        <div class="field">
          <label>تأكيد كلمة المرور الجديدة</label>
          <input type="password" name="confirm" required autocomplete="new-password">
        </div>
      </form>`, {
      footer: '<button class="btn" form="pw-form" type="submit">حفظ</button>',
    });

    modal.el.querySelector('#pw-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = ui.formData(event.target);
      if (data.new_password !== data.confirm) {
        ui.toast('كلمتا المرور غير متطابقتين', 'error');
        return;
      }
      try {
        const result = await api.post('/auth/change-password', {
          current_password: data.current_password,
          new_password: data.new_password,
        });
        modal.close();
        ui.toast(result.message, 'success');
        App.user.must_change_password = false;
      } catch (error) {
        ui.fail(error);
      }
    });
  }

  // ------------------------------------------------------------ الإشعارات

  async function toggleNotifications() {
    const existing = document.querySelector('.dropdown[data-notif]');
    if (existing) { existing.remove(); return; }
    closeDropdowns();

    const menu = document.createElement('div');
    menu.className = 'dropdown';
    menu.dataset.notif = '1';
    menu.innerHTML = '<div class="dropdown-head">الإشعارات</div><div class="dropdown-list"><div class="empty">جارٍ التحميل…</div></div>';
    document.querySelector('.main').appendChild(menu);

    try {
      const result = await api.get('/notifications');
      const list = result.data.length ? result.data.map((n) => `
        <div class="notif-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}" data-link="${ui.esc(n.link || '')}">
          <div>
            <div><b>${ui.esc(n.title)}</b></div>
            ${n.body ? `<div class="body">${ui.esc(n.body)}</div>` : ''}
            <div class="time">${ui.ago(n.created_at)}</div>
          </div>
        </div>`).join('') : ui.empty('لا توجد إشعارات', '🔔');

      menu.innerHTML = `
        <div class="dropdown-head">
          <span>الإشعارات</span>
          <span class="spacer" style="flex:1"></span>
          <button class="btn ghost sm" data-read-all>تعليم الكل كمقروء</button>
        </div>
        <div class="dropdown-list">${list}</div>`;

      const readAll = menu.querySelector('[data-read-all]');
      if (readAll) {
        readAll.addEventListener('click', async () => {
          await api.post('/notifications/read-all');
          menu.remove();
          refreshNotificationCount();
        });
      }

      menu.querySelectorAll('.notif-item[data-id]').forEach((item) => {
        item.addEventListener('click', async () => {
          await api.post(`/notifications/${item.dataset.id}/read`);
          menu.remove();
          refreshNotificationCount();
          if (item.dataset.link) global.location.hash = item.dataset.link;
        });
      });
    } catch (error) {
      menu.querySelector('.dropdown-list').innerHTML = ui.empty('تعذّر تحميل الإشعارات');
    }
  }

  async function refreshNotificationCount() {
    try {
      const result = await api.get('/notifications');
      const badge = document.getElementById('notif-count');
      if (!badge) return;
      badge.textContent = result.unread > 99 ? '99+' : result.unread;
      badge.classList.toggle('hidden', !result.unread);
    } catch { /* تجاهل أخطاء الخلفية */ }
  }

  // ------------------------------------------------------------ التوجيه

  function parseHash() {
    const raw = global.location.hash.replace(/^#\/?/, '') || 'dashboard';
    const [path, query] = raw.split('?');
    return {
      route: path.split('/')[0] || 'dashboard',
      params: Object.fromEntries(new URLSearchParams(query || '')),
    };
  }

  async function renderRoute() {
    const { route, params } = parseHash();
    App.route = route;
    App.params = params;

    const page = PAGES[route];
    const content = document.getElementById('content');
    if (!content) return;

    document.getElementById('page-title').textContent = PAGE_TITLES[route] || 'بوابة الموظفين';
    document.querySelectorAll('#nav a').forEach((link) => {
      link.classList.toggle('active', link.dataset.route === route);
    });

    if (!page) {
      content.innerHTML = ui.empty('الصفحة المطلوبة غير موجودة', '🔍');
      return;
    }

    content.innerHTML = '<div class="boot" style="padding:3rem"><div class="spinner"></div></div>';

    try {
      await page.render(content, App, params);
    } catch (error) {
      if (error && error.status === 403) {
        content.innerHTML = ui.empty('لا تملك صلاحية الوصول إلى هذه الصفحة', '🔒');
      } else {
        content.innerHTML = ui.empty(error.message || 'تعذّر تحميل الصفحة', '⚠️');
      }
    }
  }

  // ------------------------------------------------------------ الإقلاع

  async function startApp() {
    renderLayout();
    await renderRoute();
    refreshNotificationCount();

    clearInterval(global.__notifTimer);
    global.__notifTimer = setInterval(refreshNotificationCount, 60000);

    if (App.user.must_change_password) changePasswordDialog(true);
  }

  global.addEventListener('hashchange', renderRoute);

  global.addEventListener('session-expired', () => {
    if (!App.user) return;
    App.user = null;
    clearInterval(global.__notifTimer);
    renderLogin('انتهت صلاحية الجلسة، يرجى تسجيل الدخول من جديد');
  });

  (async function init() {
    try {
      const result = await api.get('/auth/me');
      App.user = result.user;
      await startApp();
    } catch {
      renderLogin();
    }
  }());

  global.App = App;
}(window));
