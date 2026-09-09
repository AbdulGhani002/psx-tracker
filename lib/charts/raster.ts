// A small software rasteriser that produces PNG bytes with nothing but Node's
// own zlib. It exists because the charts have to be made on the server, inside
// the standalone bundle, and sent to Telegram as images; a native canvas or an
// SVG-to-PNG library would need platform binaries the standalone tar does not
// carry. Everything here is plain arithmetic on a byte buffer.
//
// Drawing happens at a supersample scale (default 2x) and is box-filtered down
// on output, which is what gives lines their anti-aliasing. Coordinates passed
// in are always in LOGICAL pixels; the scale is an internal detail.

import { deflateSync } from "node:zlib";
import { glyph, GLYPH_H, GLYPH_W, CHAR_ADVANCE } from "./font";

export type Rgb = [number, number, number];

export const INK: Rgb = [20, 20, 20];
export const PAPER: Rgb = [250, 248, 243];
export const GREY: Rgb = [140, 140, 140];
export const LIGHT: Rgb = [200, 200, 200];
export const FAINT: Rgb = [232, 230, 224];
export const MID: Rgb = [90, 90, 90];

export class Raster {
  readonly W: number;
  readonly H: number;
  private readonly buf: Float32Array; // RGB, premultiplied by nothing; alpha blended in place

  constructor(
    public readonly width: number,
    public readonly height: number,
    public readonly scale = 2
  ) {
    this.W = width * scale;
    this.H = height * scale;
    this.buf = new Float32Array(this.W * this.H * 3);
  }

  clear(rgb: Rgb) {
    for (let i = 0; i < this.buf.length; i += 3) {
      this.buf[i] = rgb[0];
      this.buf[i + 1] = rgb[1];
      this.buf[i + 2] = rgb[2];
    }
  }

  // Blend one high-resolution pixel.
  private px(x: number, y: number, rgb: Rgb, a: number) {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H || a <= 0) return;
    const i = (y * this.W + x) * 3;
    const k = a >= 1 ? 1 : a;
    this.buf[i] += (rgb[0] - this.buf[i]) * k;
    this.buf[i + 1] += (rgb[1] - this.buf[i + 1]) * k;
    this.buf[i + 2] += (rgb[2] - this.buf[i + 2]) * k;
  }

  // Axis-aligned rectangle in logical coordinates.
  fillRect(x: number, y: number, w: number, h: number, rgb: Rgb, a = 1) {
    const s = this.scale;
    const x0 = Math.max(0, Math.round(x * s));
    const y0 = Math.max(0, Math.round(y * s));
    const x1 = Math.min(this.W, Math.round((x + w) * s));
    const y1 = Math.min(this.H, Math.round((y + h) * s));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.px(xx, yy, rgb, a);
  }

  // A filled disc, used as the pen for thick lines.
  private disc(cx: number, cy: number, r: number, rgb: Rgb, a: number) {
    const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r);
    const y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
    const r2 = r * r;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) this.px(x, y, rgb, a);
      }
    }
  }

  // Line in logical coordinates with a logical width. Drawn by stamping discs
  // along the segment at sub-pixel spacing; simple, and smooth enough once the
  // supersample is filtered down.
  line(x0: number, y0: number, x1: number, y1: number, rgb: Rgb, width = 1, a = 1) {
    const s = this.scale;
    const ax = x0 * s, ay = y0 * s, bx = x1 * s, by = y1 * s;
    const r = Math.max(0.5, (width * s) / 2);
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len / (r * 0.6)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.disc(ax + (bx - ax) * t, ay + (by - ay) * t, r, rgb, a);
    }
  }

  polyline(pts: Array<[number, number]>, rgb: Rgb, width = 1, dash?: [number, number], a = 1) {
    if (pts.length < 2) return;
    if (!dash) {
      for (let i = 1; i < pts.length; i++) this.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], rgb, width, a);
      return;
    }
    // Dashes are measured along the path so they stay even across joints.
    const [on, off] = dash;
    let phase = 0;
    let pen = true;
    for (let i = 1; i < pts.length; i++) {
      let [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      let remaining = Math.hypot(x1 - x0, y1 - y0);
      const ux = remaining > 0 ? (x1 - x0) / remaining : 0;
      const uy = remaining > 0 ? (y1 - y0) / remaining : 0;
      while (remaining > 0) {
        const seg = (pen ? on : off) - phase;
        const d = Math.min(seg, remaining);
        const nx = x0 + ux * d, ny = y0 + uy * d;
        if (pen) this.line(x0, y0, nx, ny, rgb, width, a);
        x0 = nx; y0 = ny;
        remaining -= d;
        phase += d;
        if (phase >= (pen ? on : off) - 1e-9) {
          phase = 0;
          pen = !pen;
        }
      }
    }
  }

  // Text from the bitmap font. `size` is logical pixels per font pixel, so
  // size 2 gives a 10x14 glyph. Returns the width drawn.
  text(x: number, y: number, str: string, rgb: Rgb, size = 2, a = 1): number {
    let cx = x;
    for (const ch of str) {
      const g = glyph(ch);
      for (let row = 0; row < GLYPH_H; row++) {
        const bits = g[row] ?? 0;
        for (let col = 0; col < GLYPH_W; col++) {
          if (bits & (1 << (GLYPH_W - 1 - col))) {
            this.fillRect(cx + col * size, y + row * size, size, size, rgb, a);
          }
        }
      }
      cx += CHAR_ADVANCE * size;
    }
    return cx - x;
  }

  textWidth(str: string, size = 2): number {
    return Math.max(0, str.length * CHAR_ADVANCE * size - size);
  }

  textRight(xRight: number, y: number, str: string, rgb: Rgb, size = 2, a = 1) {
    this.text(xRight - this.textWidth(str, size), y, str, rgb, size, a);
  }

  textCenter(xc: number, y: number, str: string, rgb: Rgb, size = 2, a = 1) {
    this.text(xc - this.textWidth(str, size) / 2, y, str, rgb, size, a);
  }

  // Box-filter down to logical size and encode as an 8-bit RGB PNG.
  toPng(): Buffer {
    const { width: w, height: h, scale: s } = this;
    const row = new Uint8Array(w * 3);
    const raw = Buffer.alloc((w * 3 + 1) * h);
    const n = s * s;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0;
        for (let dy = 0; dy < s; dy++) {
          let i = ((y * s + dy) * this.W + x * s) * 3;
          for (let dx = 0; dx < s; dx++) {
            r += this.buf[i]; g += this.buf[i + 1]; b += this.buf[i + 2];
            i += 3;
          }
        }
        row[x * 3] = clamp8(r / n);
        row[x * 3 + 1] = clamp8(g / n);
        row[x * 3 + 2] = clamp8(b / n);
      }
      const off = y * (w * 3 + 1);
      raw[off] = 0; // filter type: none
      raw.set(row, off + 1);
    }
    return encodePng(w, h, raw);
  }
}

const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

// --- PNG container ------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  const joined = Buffer.concat([typeBytes, Buffer.from(data)]);
  crc.writeUInt32BE(crc32(joined), 0);
  return Buffer.concat([len, typeBytes, Buffer.from(data), crc]);
}

function encodePng(w: number, h: number, filteredRows: Buffer): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const idat = deflateSync(filteredRows, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))]);
}
