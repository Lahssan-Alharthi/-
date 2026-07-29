'use strict';

const config = require('../config');

const DAY_MS = 24 * 60 * 60 * 1000;

/** التاريخ الحالي بصيغة YYYY-MM-DD. */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/** الوقت الحالي بصيغة HH:MM. */
function nowTime() {
  return new Date().toTimeString().slice(0, 5);
}

/** الطابع الزمني الحالي بصيغة YYYY-MM-DD HH:MM:SS. */
function nowStamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** يحوّل "HH:MM" إلى عدد الدقائق منذ منتصف الليل. */
function toMinutes(time) {
  if (!time) return null;
  const [h, m] = String(time).slice(0, 5).split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/** هل اليوم عطلة نهاية أسبوع حسب سياسة الشركة؟ */
function isWeekend(dateStr) {
  const day = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return config.work.weekend.includes(day);
}

/** عدد الأيام بين تاريخين شاملاً الطرفين. */
function daysBetween(startDate, endDate) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.floor((end - start) / DAY_MS) + 1;
}

/** عدد أيام العمل الفعلية بين تاريخين (باستثناء نهاية الأسبوع). */
function workingDaysBetween(startDate, endDate) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;

  let count = 0;
  for (let t = start; t <= end; t += DAY_MS) {
    const iso = new Date(t).toISOString().slice(0, 10);
    if (!isWeekend(iso)) count += 1;
  }
  return count;
}

/** يضيف عدداً من الأيام إلى تاريخ. */
function addDays(dateStr, days) {
  const base = Date.parse(`${dateStr}T00:00:00Z`);
  return new Date(base + days * DAY_MS).toISOString().slice(0, 10);
}

/** أول وآخر يوم في شهر معيّن. */
function monthRange(year, month) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { from, to, days: lastDay };
}

/** التحقق من صيغة التاريخ YYYY-MM-DD. */
function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

module.exports = {
  DAY_MS,
  today,
  nowTime,
  nowStamp,
  toMinutes,
  isWeekend,
  daysBetween,
  workingDaysBetween,
  addDays,
  monthRange,
  isValidDate,
};
