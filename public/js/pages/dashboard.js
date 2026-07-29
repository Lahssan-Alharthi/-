/* لوحة التحكم */
(function registerDashboard(global) {
  'use strict';

  global.PAGES = global.PAGES || {};

  function personalCards(data) {
    const record = data.personal.attendance_today;
    const attendanceValue = record && record.check_in
      ? `${ui.time(record.check_in)}${record.check_out ? ` — ${ui.time(record.check_out)}` : ''}`
      : 'لم يُسجّل';

    return `
      <div class="grid grid-4 mb-2">
        ${ui.stat('🕒', 'حضور اليوم', attendanceValue,
    record && record.late_minutes ? `تأخير ${record.late_minutes} دقيقة` : 'الدوام 08:00 — 17:00',
    record && record.check_in ? 'ok' : 'warn')}
        ${ui.stat('🌴', 'رصيد الإجازات', `${ui.number(data.leave_balance.remaining)} يوم`,
    `مستهلك ${ui.number(data.leave_balance.used)} من ${ui.number(data.leave_balance.entitlement)}`, 'info')}
        ${ui.stat('📝', 'طلباتي المعلّقة', ui.number(data.personal.pending_leaves + data.personal.pending_requests),
    'إجازات وخدمات قيد المعالجة', 'accent')}
        ${ui.stat('📅', 'أيام حضوري هذا الشهر', ui.number(data.month_attendance.present_days),
    `تأخير ${ui.number(data.month_attendance.late_days)} — غياب ${ui.number(data.month_attendance.absent_days)}`, 'ok')}
      </div>`;
  }

  function companyCards(company) {
    return `
      <div class="grid grid-4 mb-2">
        ${ui.stat('👥', 'إجمالي الموظفين', ui.number(company.total_employees), `${ui.number(company.departments)} أقسام`)}
        ${ui.stat('✅', 'الحضور اليوم', ui.number(company.present_today), `غياب ${ui.number(company.absent_today)}`, 'ok')}
        ${ui.stat('🌴', 'في إجازة اليوم', ui.number(company.on_leave_today), 'إجازات معتمدة', 'info')}
        ${ui.stat('⏳', 'بانتظار الاعتماد', ui.number(company.pending_leaves + company.pending_requests),
    `${ui.number(company.pending_leaves)} إجازة — ${ui.number(company.pending_requests)} طلب`, 'warn')}
      </div>`;
  }

  function fleetCards(fleet) {
    return `
      <div class="grid grid-4 mb-2">
        ${ui.stat('🛻', 'مركبات الأسطول', ui.number(fleet.total), `متاحة ${ui.number(fleet.available)}`)}
        ${ui.stat('🚚', 'رحلات جارية', ui.number(fleet.trips_in_progress), `مخططة ${ui.number(fleet.trips_planned)}`, 'info')}
        ${ui.stat('🔧', 'في الصيانة', ui.number(fleet.maintenance), 'مركبات خارج التشغيل', 'warn')}
        ${ui.stat('📦', 'رحلات مكتملة (30 يوم)', ui.number(fleet.trips_completed_30d), 'خلال آخر شهر', 'ok')}
      </div>`;
  }

  global.PAGES.dashboard = {
    async render(container, App) {
      const [dashboard, todayState] = await Promise.all([
        api.get('/dashboard'),
        api.get('/attendance/today'),
      ]);
      const data = dashboard.data;
      const state = todayState.data;

      const checkButtons = state.is_weekend
        ? '<span class="badge neutral">اليوم عطلة نهاية الأسبوع</span>'
        : `
          <button class="btn" id="check-in" ${state.can_check_in ? '' : 'disabled'}>تسجيل حضور</button>
          <button class="btn accent" id="check-out" ${state.can_check_out ? '' : 'disabled'}>تسجيل انصراف</button>`;

      const balance = data.leave_balance;
      const usedPercent = balance.entitlement ? (balance.used / balance.entitlement) * 100 : 0;

      container.innerHTML = `
        <div class="card">
          <div class="card-body flex flex-wrap">
            <div>
              <h2 class="mb-0">أهلاً ${ui.esc(ui.shortName(App.user.full_name_ar))} 👋</h2>
              <div class="muted small">${ui.esc(App.user.job_title || '')} — ${ui.esc(App.user.department_name || 'بدون قسم')}</div>
            </div>
            <div class="spacer"></div>
            <div class="btn-row">${checkButtons}</div>
          </div>
        </div>

        ${personalCards(data)}
        ${data.company ? companyCards(data.company) : ''}
        ${data.fleet ? fleetCards(data.fleet) : ''}

        <div class="grid grid-2">
          <div>
            ${data.attendance_trend ? `
              <div class="card">
                <div class="card-head"><h3>حضور الشركة — آخر 14 يوماً</h3></div>
                <div class="card-body">${ui.attendanceChart(data.attendance_trend)}</div>
              </div>` : ''}

            <div class="card">
              <div class="card-head">
                <h3>الإعلانات الأخيرة</h3><div class="spacer"></div>
                <a href="#/announcements" class="small">عرض الكل</a>
              </div>
              <div class="card-body tight">
                ${data.announcements.length ? data.announcements.map((a) => `
                  <div class="notif-item" style="cursor:default">
                    <div>
                      <div>${a.pinned ? '📌 ' : ''}<b>${ui.esc(a.title)}</b>
                        ${a.priority === 'urgent' ? '<span class="badge danger">عاجل</span>'
    : (a.priority === 'high' ? '<span class="badge warn">هام</span>' : '')}</div>
                      <div class="time">${ui.esc(a.author_name || '')} — ${ui.ago(a.published_at)}</div>
                    </div>
                  </div>`).join('') : ui.empty('لا توجد إعلانات', '📢')}
              </div>
            </div>

            ${data.approvals ? `
              <div class="card">
                <div class="card-head"><h3>بانتظار اعتمادك</h3><div class="spacer"></div>
                  <a href="#/leaves" class="small">إدارة الطلبات</a></div>
                <div class="card-body tight">
                  ${ui.table([
    { title: 'الموظف', key: 'employee_name' },
    { title: 'النوع', key: 'leave_type_name' },
    { title: 'من', render: (r) => ui.dateShort(r.start_date) },
    { title: 'إلى', render: (r) => ui.dateShort(r.end_date) },
    { title: 'الأيام', key: 'days', cls: 'num' },
  ], data.approvals, 'لا توجد طلبات بانتظار اعتمادك')}
                </div>
              </div>` : ''}
          </div>

          <div>
            <div class="card">
              <div class="card-head"><h3>رصيد الإجازة السنوية</h3></div>
              <div class="card-body">
                ${ui.ring(usedPercent, `${ui.number(balance.remaining)} يوم متبقٍ`,
    `من أصل ${ui.number(balance.entitlement)} يوم — مستهلك ${ui.number(balance.used)}`)}
                <div class="mt-2">
                  <a class="btn secondary block" href="#/leaves">تقديم طلب إجازة</a>
                </div>
              </div>
            </div>

            <div class="card">
              <div class="card-head"><h3>ملخّص دوامي هذا الشهر</h3></div>
              <div class="card-body">
                <div class="info-list">
                  <div class="row"><span class="k">أيام الحضور</span><span class="v">${ui.number(data.month_attendance.present_days)}</span></div>
                  <div class="row"><span class="k">أيام التأخير</span><span class="v">${ui.number(data.month_attendance.late_days)}</span></div>
                  <div class="row"><span class="k">أيام الغياب</span><span class="v">${ui.number(data.month_attendance.absent_days)}</span></div>
                  <div class="row"><span class="k">إجمالي ساعات العمل</span><span class="v">${ui.duration(data.month_attendance.work_minutes)}</span></div>
                </div>
              </div>
            </div>

            ${data.my_upcoming_leaves.length ? `
              <div class="card">
                <div class="card-head"><h3>إجازاتي القادمة</h3></div>
                <div class="card-body tight">
                  ${ui.table([
    { title: 'النوع', key: 'leave_type_name' },
    { title: 'من', render: (r) => ui.dateShort(r.start_date) },
    { title: 'إلى', render: (r) => ui.dateShort(r.end_date) },
    { title: 'الحالة', render: (r) => ui.status(r.status) },
  ], data.my_upcoming_leaves)}
                </div>
              </div>` : ''}

            ${data.headcount_by_department ? `
              <div class="card">
                <div class="card-head"><h3>توزيع الموظفين على الأقسام</h3></div>
                <div class="card-body">${ui.bars(data.headcount_by_department)}</div>
              </div>` : ''}

            ${data.expiring_documents && data.expiring_documents.length ? `
              <div class="card">
                <div class="card-head"><h3>وثائق تقارب الانتهاء</h3></div>
                <div class="card-body tight">
                  ${ui.table([
    { title: 'الموظف', key: 'full_name_ar' },
    { title: 'انتهاء الإقامة', render: (r) => ui.dateShort(r.iqama_expiry) },
    { title: 'انتهاء الرخصة', render: (r) => ui.dateShort(r.license_expiry) },
  ], data.expiring_documents)}
                </div>
              </div>` : ''}

            ${data.fleet && data.fleet.alerts.length ? `
              <div class="card">
                <div class="card-head"><h3>تنبيهات الأسطول</h3></div>
                <div class="card-body tight">
                  ${ui.table([
    { title: 'اللوحة', key: 'plate_no' },
    { title: 'التأمين', render: (r) => ui.dateShort(r.insurance_expiry) },
    { title: 'الاستمارة', render: (r) => ui.dateShort(r.registration_expiry) },
    { title: 'الصيانة القادمة', render: (r) => ui.dateShort(r.next_maintenance) },
  ], data.fleet.alerts)}
                </div>
              </div>` : ''}
          </div>
        </div>`;

      // تسجيل الحضور يمرّ عبر pwa ليُؤجَّل تلقائياً عند انقطاع الاتصال
      const bindCheck = (selector, path) => {
        const button = container.querySelector(selector);
        if (!button) return;
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const result = await pwa.markAttendance(path);
            ui.toast(result.message, result.queued ? 'warn' : 'success');
            if (!result.queued) App.refresh();
          } catch (error) { ui.fail(error); button.disabled = false; }
        });
      };

      bindCheck('#check-in', '/attendance/check-in');
      bindCheck('#check-out', '/attendance/check-out');
    },
  };
}(window));
