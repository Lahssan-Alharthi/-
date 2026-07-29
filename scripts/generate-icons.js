'use strict';

/**
 * يولّد أيقونات التطبيق (PNG) بلا اعتماديات خارجية.
 * التشغيل: npm run icons
 *
 * التصميم: مربّع بلون الشركة بزوايا دائرية، وداخله رمز شاحنة أبيض
 * يشير إلى نشاط الشركة اللوجستي.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BRAND = [13, 92, 74]; // #0d5c4a
const ACCENT = [201, 150, 47]; // #c9962f
const WHITE = [255, 255, 255];

const OUT_DIR = path.join(__dirname, '..', 'public', 'icons');

/** يبني ملف PNG من مصفوفة بكسلات RGBA. */
function encodePng(width, height, pixels) {
  const crcTable = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buffer) => {
    let c = 0xffffffff;
    for (let i = 0; i < buffer.length; i += 1) c = crcTable[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeAndData), 0);
    return Buffer.concat([length, typeAndData, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // عمق البت
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // كل سطر يبدأ ببايت نوع الترشيح (0 = بلا ترشيح)
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** لوحة رسم بسيطة تدعم المستطيلات والدوائر والزوايا الدائرية. */
function canvas(size) {
  const pixels = Buffer.alloc(size * size * 4, 0);

  const set = (x, y, color, alpha) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const a = alpha === undefined ? 1 : alpha;
    // دمج ألفا فوق ما هو موجود
    const existing = pixels[i + 3] / 255;
    const outAlpha = a + existing * (1 - a);
    if (outAlpha <= 0) return;
    for (let c = 0; c < 3; c += 1) {
      pixels[i + c] = Math.round((color[c] * a + pixels[i + c] * existing * (1 - a)) / outAlpha);
    }
    pixels[i + 3] = Math.round(outAlpha * 255);
  };

  return {
    pixels,
    /** مستطيل بزوايا دائرية، بتنعيم على الحدود. */
    roundedRect(x0, y0, w, h, radius, color) {
      for (let y = Math.floor(y0); y < y0 + h; y += 1) {
        for (let x = Math.floor(x0); x < x0 + w; x += 1) {
          const dx = Math.max(x0 + radius - x, x - (x0 + w - 1 - radius), 0);
          const dy = Math.max(y0 + radius - y, y - (y0 + h - 1 - radius), 0);
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance <= radius - 0.5) set(x, y, color);
          else if (distance < radius + 0.5) set(x, y, color, radius + 0.5 - distance);
        }
      }
    },
    circle(cx, cy, r, color) {
      for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y += 1) {
        for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x += 1) {
          const distance = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
          if (distance <= r - 0.5) set(x, y, color);
          else if (distance < r + 0.5) set(x, y, color, r + 0.5 - distance);
        }
      }
    },
  };
}

/** يرسم الأيقونة بمقاس معيّن. maskable يزيد الهامش الآمن. */
function drawIcon(size, maskable) {
  const c = canvas(size);
  const u = size / 100; // وحدة نسبية

  // الخلفية
  if (maskable) {
    c.roundedRect(0, 0, size, size, 0, BRAND);
  } else {
    c.roundedRect(0, 0, size, size, 22 * u, BRAND);
  }

  const inset = maskable ? 12 : 0; // هامش آمن لأيقونة القناع
  const scale = (value) => (value * (100 - inset * 2) / 100 + inset) * u;
  const len = (value) => value * (100 - inset * 2) / 100 * u;

  // صندوق الشاحنة
  c.roundedRect(scale(18), scale(36), len(38), len(28), 3 * u, WHITE);
  // كابينة القيادة
  c.roundedRect(scale(58), scale(45), len(24), len(19), 3 * u, WHITE);
  // نافذة الكابينة
  c.roundedRect(scale(63), scale(49), len(14), len(9), 2 * u, BRAND);
  // خط الحمولة
  c.roundedRect(scale(24), scale(43), len(26), len(4), 2 * u, BRAND);

  // العجلات
  const wheelY = scale(70);
  c.circle(scale(31), wheelY, len(8.5), WHITE);
  c.circle(scale(31), wheelY, len(4), BRAND);
  c.circle(scale(69), wheelY, len(8.5), WHITE);
  c.circle(scale(69), wheelY, len(4), BRAND);

  // شريط بلون الشركة الثانوي أسفل الأيقونة
  c.roundedRect(scale(22), scale(83), len(56), len(5), 2.5 * u, ACCENT);

  return encodePng(size, size, c.pixels);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
];

targets.forEach(([name, size, maskable]) => {
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, drawIcon(size, maskable));
  // eslint-disable-next-line no-console
  console.log(`تم إنشاء ${name} (${size}×${size})`);
});
