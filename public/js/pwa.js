/* تهيئة التطبيق على الجوال: عامل الخدمة، حالة الاتصال، وطابور الإجراءات المعلّقة */
(function attachPwa(global) {
  'use strict';

  const QUEUE_KEY = 'madad.pending_attendance';

  const pwa = {
    online: navigator.onLine,
    installPrompt: null,

    // -------------------------------------------------- طابور دون اتصال

    /** الإجراءات المؤجّلة المحفوظة محلياً. */
    pending() {
      try {
        const raw = global.localStorage.getItem(QUEUE_KEY);
        return raw ? JSON.parse(raw) : [];
      } catch {
        return [];
      }
    },

    savePending(list) {
      try {
        global.localStorage.setItem(QUEUE_KEY, JSON.stringify(list));
      } catch { /* الذاكرة المحلية ممتلئة أو معطّلة */ }
    },

    /** يضيف إجراء حضور مؤجّلاً ليُرسل عند عودة الاتصال. */
    enqueue(path) {
      const list = pwa.pending();
      // لا نكرّر الإجراء نفسه في اليوم نفسه
      const today = new Date().toISOString().slice(0, 10);
      if (list.some((item) => item.path === path && item.date === today)) return false;

      list.push({ path, date: today, at: new Date().toISOString() });
      pwa.savePending(list);
      pwa.renderIndicator();
      return true;
    },

    /** يرسل الإجراءات المؤجّلة بالترتيب، ويحتفظ بما فشل لأسباب شبكية. */
    async flush() {
      if (!navigator.onLine) return;

      const list = pwa.pending();
      if (!list.length) return;

      const remaining = [];
      let sent = 0;

      for (const item of list) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await global.api.post(item.path);
          sent += 1;
        } catch (error) {
          // خطأ منطقي (كأن الحضور سُجّل مسبقاً) لا يُعاد المحاولة فيه
          if (error && error.status && error.status < 500) continue;
          remaining.push(item);
        }
      }

      pwa.savePending(remaining);
      pwa.renderIndicator();

      if (sent && global.ui) {
        global.ui.toast(`تم إرسال ${sent} تسجيل حضور كان مؤجّلاً`, 'success');
        if (global.App && global.App.user) global.App.refresh();
      }
    },

    /**
     * ينفّذ تسجيل حضور أو انصراف، ويؤجّله عند انقطاع الاتصال.
     * يعيد { queued, message } لتعرض الصفحة الرسالة المناسبة.
     */
    async markAttendance(path) {
      try {
        const result = await global.api.post(path);
        return { queued: false, message: result.message };
      } catch (error) {
        const offline = !navigator.onLine || error.offline || error.status === 503;
        if (!offline) throw error;

        const added = pwa.enqueue(path);
        return {
          queued: true,
          message: added
            ? 'لا يوجد اتصال — حُفظ التسجيل وسيُرسل تلقائياً عند عودة الشبكة'
            : 'التسجيل محفوظ مسبقاً وسيُرسل عند عودة الشبكة',
        };
      }
    },

    // ------------------------------------------------------ حالة الاتصال

    /** يعرض شريط «غير متصل» وعدّاد الإجراءات المؤجّلة. */
    renderIndicator() {
      let bar = document.getElementById('offline-bar');
      const pendingCount = pwa.pending().length;
      const show = !navigator.onLine || pendingCount > 0;

      if (!show) {
        if (bar) bar.remove();
        return;
      }

      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'offline-bar';
        bar.className = 'offline-bar';
        document.body.appendChild(bar);
      }

      bar.classList.toggle('pending-only', navigator.onLine);
      bar.innerHTML = navigator.onLine
        ? `<span>⏳</span> ${pendingCount} تسجيل بانتظار الإرسال…`
        : `<span>📴</span> لا يوجد اتصال — تعرض البوابة آخر بيانات محفوظة${pendingCount ? ` (${pendingCount} تسجيل مؤجّل)` : ''}`;
    },

    // --------------------------------------------------------- التثبيت

    /** يعرض زر «تثبيت التطبيق» عند توفّر إمكانية التثبيت. */
    showInstallButton() {
      if (!pwa.installPrompt) return;
      const topbar = document.querySelector('.topbar');
      if (!topbar || document.getElementById('install-btn')) return;

      const button = document.createElement('button');
      button.id = 'install-btn';
      button.className = 'icon-btn';
      button.title = 'تثبيت التطبيق على الجهاز';
      button.setAttribute('aria-label', 'تثبيت التطبيق');
      button.textContent = '⬇️';

      button.addEventListener('click', async () => {
        if (!pwa.installPrompt) return;
        pwa.installPrompt.prompt();
        const choice = await pwa.installPrompt.userChoice;
        pwa.installPrompt = null;
        button.remove();
        if (choice.outcome === 'accepted' && global.ui) {
          global.ui.toast('تم تثبيت البوابة على جهازك', 'success');
        }
      });

      topbar.insertBefore(button, topbar.querySelector('#notif-btn'));
    },
  };

  // ------------------------------------------------------------ التسجيل

  if ('serviceWorker' in navigator) {
    global.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((registration) => {
        // عند توفّر إصدار جديد نطبّقه فوراً في التحميل التالي
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (installing) {
            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                installing.postMessage('skip-waiting');
              }
            });
          }
        });
      }).catch(() => { /* التثبيت غير متاح (مثلاً بلا HTTPS) */ });
    });
  }

  global.addEventListener('online', () => {
    pwa.online = true;
    pwa.renderIndicator();
    pwa.flush();
  });

  global.addEventListener('offline', () => {
    pwa.online = false;
    pwa.renderIndicator();
  });

  global.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    pwa.installPrompt = event;
    pwa.showInstallButton();
  });

  document.addEventListener('DOMContentLoaded', () => {
    pwa.renderIndicator();
    if (navigator.onLine) pwa.flush();
  });

  global.pwa = pwa;
}(window));
