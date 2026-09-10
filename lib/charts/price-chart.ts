// A price chart drawn for Telegram: close, two moving averages, the buy and
// sell bands you wrote down, and your average cost. Monochrome on paper, like
// the rest of the app, because a chart that has to be read on a phone in
// daylight does better with weight than with colour.

import { Raster, INK, PAPER, GREY, LIGHT, FAINT, MID, type Rgb } from "./raster";

export type ChartBar = { date: string; close: number };

export type PriceChartInput = {
  title: string;
  subtitle?: string;
  bars: ChartBar[]; // the window to draw, oldest first
  ma50?: Array<number | null>; // aligned to bars
  ma200?: Array<number | null>;
  buyZone?: { low: number | null; high: number | null };
  sellZone?: { low: number | null; high: number | null };
  avgCost?: number | null;
  // Where the model puts the price `horizon` sessions on: the centre, one
  // standard deviation either side, and the 5% dip level. Drawn as a fan to
  // the right of the last bar.
  projection?: { horizon: number; median: number; low: number; high: number; dipLevel: number } | null;
  footer?: string;
  width?: number;
  height?: number;
};

const T = 64, B = 52;

// Ticks a person would draw: 1, 2, 2.5, 5 times a power of ten.
function niceTicks(lo: number, hi: number, want = 6): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / want;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

const fmt = (v: number): string => {
  if (Math.abs(v) >= 10000) return Math.round(v).toLocaleString("en-US");
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
};

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function renderPriceChart(input: PriceChartInput): Buffer {
  const width = input.width ?? 1200;
  const height = input.height ?? 620;
  const r = new Raster(width, height, 2);
  r.clear(PAPER);

  const bars = input.bars.filter((b) => Number.isFinite(b.close) && b.close > 0);
  const plotH = height - T - B;

  if (bars.length < 2) {
    r.text(84, 18, input.title.toUpperCase(), INK, 3);
    r.text(84, T + plotH / 2, "NOT ENOUGH PRICE HISTORY TO DRAW", GREY, 2);
    return r.toPng();
  }

  // --- scales -----------------------------------------------------------------
  const closes = bars.map((b) => b.close);
  const extra: number[] = [];
  for (const arr of [input.ma50, input.ma200]) if (arr) for (const v of arr) if (v != null && Number.isFinite(v)) extra.push(v);
  if (input.avgCost != null && input.avgCost > 0) extra.push(input.avgCost);
  const proj = input.projection && input.projection.horizon > 0 ? input.projection : null;
  if (proj) extra.push(proj.low, proj.high, proj.dipLevel);
  for (const z of [input.buyZone, input.sellZone]) {
    if (z?.low != null && z.low > 0) extra.push(z.low);
    if (z?.high != null && z.high > 0) extra.push(z.high);
  }
  let lo = Math.min(...closes, ...extra);
  let hi = Math.max(...closes, ...extra);
  const pad = (hi - lo) * 0.06 || hi * 0.02;
  lo -= pad;
  hi += pad;
  if (lo < 0) lo = 0;

  // Margins follow the labels: the left one is as wide as the widest price
  // tick, the right one opens up when a projection needs its levels written
  // beside the fan.
  const ticks = niceTicks(lo, hi, 6);
  const L = Math.max(84, Math.max(...ticks.map((t) => r.textWidth(fmt(t), 2))) + 18);
  const R = proj ? 136 : 24;
  const plotW = width - L - R;

  // --- title ------------------------------------------------------------------
  r.text(L, 18, input.title.toUpperCase(), INK, 3);
  if (input.subtitle) r.text(L, 44, input.subtitle, MID, 2);

  // The x axis leaves room to the right for the projection, when there is one.
  const slots = bars.length - 1 + (proj ? proj.horizon : 0);
  const xAt = (i: number) => L + (i / slots) * plotW;
  const yAt = (v: number) => T + (1 - (v - lo) / (hi - lo)) * plotH;

  // --- bands, drawn first so the price sits on top ------------------------------
  const band = (z: { low: number | null; high: number | null } | undefined, shade: Rgb, label: string) => {
    if (!z) return;
    const top = z.high != null && z.high > 0 ? z.high : null;
    const bot = z.low != null && z.low > 0 ? z.low : null;
    if (top == null && bot == null) return;
    const y0 = yAt(top ?? hi);
    const y1 = yAt(bot ?? lo);
    r.fillRect(L, Math.min(y0, y1), plotW, Math.abs(y1 - y0), shade, 1);
    // A hairline on each defined edge, so the band reads as a rule, not a smudge.
    if (top != null) r.line(L, y0, L + plotW, y0, LIGHT, 1);
    if (bot != null) r.line(L, y1, L + plotW, y1, LIGHT, 1);
    // Labelled on the left: the right edge belongs to the last-price callout.
    r.text(L + 6, Math.min(y0, y1) + 6, label, GREY, 2);
  };
  band(input.buyZone, FAINT, "BUY ZONE");
  band(input.sellZone, [240, 236, 228], "SELL ZONE");

  // --- grid and axes ----------------------------------------------------------
  for (const tv of ticks) {
    const y = yAt(tv);
    r.line(L, y, L + plotW, y, FAINT, 1);
    r.textRight(L - 10, y - 5, fmt(tv), GREY, 2);
  }
  r.line(L, T, L, T + plotH, LIGHT, 1);
  r.line(L, T + plotH, L + plotW, T + plotH, LIGHT, 1);

  // Month boundaries on the x axis; thin the labels when there are many.
  const monthStarts: number[] = [];
  for (let i = 1; i < bars.length; i++) if (bars[i].date.slice(0, 7) !== bars[i - 1].date.slice(0, 7)) monthStarts.push(i);
  const every = monthStarts.length > 14 ? Math.ceil(monthStarts.length / 12) : 1;
  monthStarts.forEach((i, k) => {
    const x = xAt(i);
    r.line(x, T + plotH, x, T + plotH + 5, LIGHT, 1);
    if (k % every === 0) {
      const d = bars[i].date;
      const m = MONTHS[Number(d.slice(5, 7)) - 1];
      const lbl = m === "JAN" || k === 0 ? `${m} ${d.slice(2, 4)}` : m;
      r.textCenter(x, T + plotH + 12, lbl, GREY, 2);
    }
  });

  // --- moving averages ----------------------------------------------------------
  const maLine = (arr: Array<number | null> | undefined, rgb: Rgb, dash: [number, number]) => {
    if (!arr) return;
    let run: Array<[number, number]> = [];
    const flush = () => {
      if (run.length > 1) r.polyline(run, rgb, 1.6, dash);
      run = [];
    };
    for (let i = 0; i < bars.length; i++) {
      const v = arr[i];
      if (v == null || !Number.isFinite(v)) flush();
      else run.push([xAt(i), yAt(v)]);
    }
    flush();
  };
  maLine(input.ma200, MID, [7, 5]);
  maLine(input.ma50, GREY, [3, 4]);

  // --- average cost -------------------------------------------------------------
  if (input.avgCost != null && input.avgCost > 0) {
    const y = yAt(input.avgCost);
    r.polyline([[L, y], [L + plotW, y]], INK, 1, [2, 4]);
    r.text(L + 6, y - 14, `COST ${fmt(input.avgCost)}`, INK, 2);
  }

  // --- the price itself -----------------------------------------------------------
  r.polyline(bars.map((b, i) => [xAt(i), yAt(b.close)] as [number, number]), INK, 2.2);

  // Last price, called out at the last bar.
  const last = bars[bars.length - 1];
  const ly = yAt(last.close);
  const lx0 = xAt(bars.length - 1);
  r.fillRect(lx0 - 2, ly - 2, 5, 5, INK);
  r.textRight(lx0 - 8, Math.max(T + 2, ly - 22), fmt(last.close), INK, 2);

  // --- the projection fan -----------------------------------------------------------
  if (proj) {
    const xe = L + plotW;
    const yM = yAt(proj.median), yH = yAt(proj.high), yL = yAt(proj.low);
    r.polyline([[lx0, ly], [xe, yH]], LIGHT, 1, [3, 3]);
    r.polyline([[lx0, ly], [xe, yL]], LIGHT, 1, [3, 3]);
    r.polyline([[lx0, ly], [xe, yM]], INK, 1.4, [5, 4]);
    r.line(xe, yH, xe, yL, LIGHT, 1);
    // The levels are written in the right margin, each at its own height,
    // nudged apart when two would collide.
    const labels: Array<{ y: number; text: string; rgb: Rgb }> = [
      { y: yH, text: fmt(proj.high), rgb: GREY },
      { y: yM, text: fmt(proj.median), rgb: INK },
      { y: yL, text: fmt(proj.low), rgb: GREY },
    ];
    const yD = yAt(proj.dipLevel);
    if (yD > T && yD < T + plotH) {
      r.polyline([[lx0, yD], [xe, yD]], GREY, 1, [1, 3]);
      labels.push({ y: yD, text: `DIP ${fmt(proj.dipLevel)}`, rgb: GREY });
    }
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 15) labels[i].y = labels[i - 1].y + 15;
    for (const lb of labels) r.text(xe + 6, Math.min(T + plotH - 12, Math.max(T + 2, lb.y - 5)), lb.text, lb.rgb, 2);
    r.textCenter((lx0 + xe) / 2, T + plotH + 12, `+${proj.horizon}D`, GREY, 2);
  }

  // --- legend ---------------------------------------------------------------------
  // On the title row, right-aligned, where nothing else needs the space. The
  // subtitle row below it can then run the full width without a collision.
  let lx = width - R;
  const legend = (label: string, rgb: Rgb, dash?: [number, number]) => {
    const w = r.textWidth(label, 2);
    lx -= w + 40;
    r.polyline([[lx, 25], [lx + 22, 25]], rgb, 1.6, dash);
    r.text(lx + 28, 19, label, MID, 2);
  };
  if (input.ma200?.some((v) => v != null)) legend("200D", MID, [7, 5]);
  if (input.ma50?.some((v) => v != null)) legend("50D", GREY, [3, 4]);
  legend("CLOSE", INK);

  // --- footer -----------------------------------------------------------------------
  if (input.footer) r.text(L, height - 22, input.footer, MID, 2);
  r.textRight(width - R, height - 22, `${bars[0].date} TO ${last.date}`, GREY, 2);

  return r.toPng();
}

// Simple moving average aligned to the input, null until the window fills.
export function sma(values: number[], n: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}
