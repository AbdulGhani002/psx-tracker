"use client";

import { useState } from "react";

// Small investing arithmetic, each with its inputs on the left and the
// answer on the right. Nothing here reads your data; type the numbers in.

const rs = (v: number) => (Number.isFinite(v) ? `Rs ${Math.round(v).toLocaleString("en-US")}` : "–");
const pct = (v: number, d = 2) => (Number.isFinite(v) ? `${v.toFixed(d)}%` : "–");

function Field({ label, value, onChange, step = "any", suffix }: { label: string; value: number; onChange: (v: number) => void; step?: string; suffix?: string }) {
  return (
    <label className="block">
      <span className="text-[11.5px] text-muted">{label}</span>
      <div className="flex items-center gap-2 mt-1">
        <input type="number" step={step} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Number(e.target.value))} className="w-full rounded-lg px-3 py-2 text-[13px] font-mono" style={{ background: "var(--surface-2)", border: "1px solid var(--rule)", color: "var(--ink)" }} />
        {suffix && <span className="text-[12px] text-muted">{suffix}</span>}
      </div>
    </label>
  );
}

function Result({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-[var(--rule)] last:border-0">
      <span className="text-[12.5px] text-muted">{label}</span>
      <span className="font-mono mono-num text-[14px] font-semibold" style={{ color: tone === "positive" ? "var(--positive)" : tone === "negative" ? "var(--negative)" : "var(--ink)" }}>{value}</span>
    </div>
  );
}

function Calc({ title, eyebrow, children }: { title: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <div className="card card-pad">
      <div className="label-cap">{eyebrow}</div>
      <div className="text-[15px] font-semibold mt-0.5 mb-4">{title}</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">{children}</div>
    </div>
  );
}

export function Calculators({ cgtRate, divWht, brokeragePct }: { cgtRate: number; divWht: number; brokeragePct: number }) {
  // ROI
  const [roiIn, setRoiIn] = useState(100000), [roiOut, setRoiOut] = useState(125000), [roiDays, setRoiDays] = useState(365);
  const roi = (roiOut / roiIn - 1) * 100;
  const roiAnn = roiDays > 0 ? (Math.pow(roiOut / roiIn, 365 / roiDays) - 1) * 100 : NaN;
  // CAGR
  const [cStart, setCStart] = useState(100000), [cEnd, setCEnd] = useState(250000), [cYears, setCYears] = useState(5);
  const cagr = cYears > 0 ? (Math.pow(cEnd / cStart, 1 / cYears) - 1) * 100 : NaN;
  // SIP
  const [sipMonthly, setSipMonthly] = useState(25000), [sipRate, setSipRate] = useState(14), [sipYears, setSipYears] = useState(10), [sipLump, setSipLump] = useState(0);
  const mr = sipRate / 100 / 12, nM = sipYears * 12;
  const sipFv = mr > 0 ? sipMonthly * ((Math.pow(1 + mr, nM) - 1) / mr) * (1 + mr) + sipLump * Math.pow(1 + mr, nM) : sipMonthly * nM + sipLump;
  const sipIn = sipMonthly * nM + sipLump;
  // Compounding
  const [cpAmt, setCpAmt] = useState(237628), [cpRate, setCpRate] = useState(10.3), [cpYears, setCpYears] = useState(1), [cpTax, setCpTax] = useState(cgtRate);
  const cpGross = cpAmt * Math.pow(1 + cpRate / 100, cpYears);
  const cpGain = cpGross - cpAmt;
  const cpNet = cpAmt + cpGain * (1 - cpTax / 100);
  // Deductions on a trade
  const [tQty, setTQty] = useState(500), [tPrice, setTPrice] = useState(536), [tCost, setTCost] = useState(480), [tSide, setTSide] = useState<"buy" | "sell">("buy");
  const tValue = tQty * tPrice;
  const tComm = Math.max((brokeragePct / 100) * tValue, 0.03 * tQty);
  const tSst = tComm * 0.15;
  const tGain = tSide === "sell" ? Math.max(0, (tPrice - tCost) * tQty) : 0;
  const tCgt = tGain * (cgtRate / 100);
  const tNet = tSide === "buy" ? tValue + tComm + tSst : tValue - tComm - tSst - tCgt;
  // Dividend after tax
  const [dShares, setDShares] = useState(118), [dRate, setDRate] = useState(7), [dZakat, setDZakat] = useState(false);
  const dGross = dShares * dRate, dWht = dGross * (divWht / 100), dZ = dZakat ? dGross * 0.025 : 0;
  // Peter Lynch fair value
  const [plEps, setPlEps] = useState(45), [plGrowth, setPlGrowth] = useState(15), [plYield, setPlYield] = useState(3), [plPrice, setPlPrice] = useState(536);
  const plValue = plEps * (plGrowth + plYield); // fair P/E = growth + yield
  const peg = plPrice / plEps / Math.max(0.01, plGrowth + plYield);
  // DCF (simple)
  const [fcf, setFcf] = useState(12), [g1, setG1] = useState(12), [gT, setGT] = useState(5), [disc, setDisc] = useState(18), [dcfYears, setDcfYears] = useState(5);
  let dcf = 0, f = fcf;
  for (let y = 1; y <= dcfYears; y++) {
    f *= 1 + g1 / 100;
    dcf += f / Math.pow(1 + disc / 100, y);
  }
  const terminal = disc > gT ? (f * (1 + gT / 100)) / ((disc - gT) / 100) / Math.pow(1 + disc / 100, dcfYears) : NaN;
  const dcfValue = dcf + terminal;
  // Drawdown recovery
  const [ddLoss, setDdLoss] = useState(25);
  const recover = ddLoss < 100 ? (1 / (1 - ddLoss / 100) - 1) * 100 : NaN;
  // Position size
  const [psBook, setPsBook] = useState(1400000), [psRisk, setPsRisk] = useState(1), [psEntry, setPsEntry] = useState(536), [psStop, setPsStop] = useState(482);
  const perShareRisk = Math.max(0.01, psEntry - psStop);
  const psShares = Math.floor((psBook * (psRisk / 100)) / perShareRisk);
  // Zakat
  const [zBase, setZBase] = useState(1400000), [zDebts, setZDebts] = useState(0);
  const zakat = Math.max(0, zBase - zDebts) * 0.025;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <Calc eyebrow="Return" title="ROI and annualised return">
        <div className="space-y-3"><Field label="Put in" value={roiIn} onChange={setRoiIn} suffix="Rs" /><Field label="Worth now" value={roiOut} onChange={setRoiOut} suffix="Rs" /><Field label="Held for" value={roiDays} onChange={setRoiDays} suffix="days" /></div>
        <div><Result label="Return" value={pct(roi)} tone={roi >= 0 ? "positive" : "negative"} /><Result label="Gain" value={rs(roiOut - roiIn)} /><Result label="Annualised" value={pct(roiAnn)} /></div>
      </Calc>
      <Calc eyebrow="Growth" title="Compound annual growth rate">
        <div className="space-y-3"><Field label="Start" value={cStart} onChange={setCStart} suffix="Rs" /><Field label="End" value={cEnd} onChange={setCEnd} suffix="Rs" /><Field label="Years" value={cYears} onChange={setCYears} /></div>
        <div><Result label="CAGR" value={pct(cagr)} tone={cagr >= 0 ? "positive" : "negative"} /><Result label="Multiple" value={`${(cEnd / cStart).toFixed(2)}×`} /></div>
      </Calc>
      <Calc eyebrow="Plan" title="Monthly investing (SIP)">
        <div className="space-y-3"><Field label="Each month" value={sipMonthly} onChange={setSipMonthly} suffix="Rs" /><Field label="Starting lump sum" value={sipLump} onChange={setSipLump} suffix="Rs" /><Field label="Return a year" value={sipRate} onChange={setSipRate} suffix="%" /><Field label="Years" value={sipYears} onChange={setSipYears} /></div>
        <div><Result label="Put in" value={rs(sipIn)} /><Result label="Worth at the end" value={rs(sipFv)} tone="positive" /><Result label="Growth" value={rs(sipFv - sipIn)} /></div>
      </Calc>
      <Calc eyebrow="Cash" title="Compounding, and what tax leaves">
        <div className="space-y-3"><Field label="Amount" value={cpAmt} onChange={setCpAmt} suffix="Rs" /><Field label="Rate a year" value={cpRate} onChange={setCpRate} suffix="%" /><Field label="Years" value={cpYears} onChange={setCpYears} /><Field label="Tax on the gain" value={cpTax} onChange={setCpTax} suffix="%" /></div>
        <div><Result label="Gross at the end" value={rs(cpGross)} /><Result label="Gain" value={rs(cpGain)} /><Result label="After tax" value={rs(cpNet)} tone="positive" /><Result label="Per day, gross" value={rs(cpAmt * (Math.pow(1 + cpRate / 100, 1 / 365) - 1))} /><Result label="Per Rs 1,000 a day, after tax" value={`Rs ${(1000 * (Math.pow(1 + cpRate / 100, 1 / 365) - 1) * (1 - cpTax / 100)).toFixed(3)}`} /></div>
      </Calc>
      <Calc eyebrow="Trade" title="Deductions on a trade">
        <div className="space-y-3">
          <div className="seg"><button type="button" data-active={tSide === "buy"} onClick={() => setTSide("buy")}>Buy</button><button type="button" data-active={tSide === "sell"} onClick={() => setTSide("sell")}>Sell</button></div>
          <Field label="Shares" value={tQty} onChange={setTQty} /><Field label="Price" value={tPrice} onChange={setTPrice} suffix="Rs" />
          {tSide === "sell" && <Field label="Your average cost" value={tCost} onChange={setTCost} suffix="Rs" />}
        </div>
        <div><Result label="Value" value={rs(tValue)} /><Result label={`Commission (${brokeragePct}%, floor 3 paisa a share)`} value={`Rs ${tComm.toFixed(2)}`} /><Result label="Sales tax on commission (15%)" value={`Rs ${tSst.toFixed(2)}`} />{tSide === "sell" && <Result label={`Capital gains tax (${cgtRate}% of the gain)`} value={`Rs ${tCgt.toFixed(2)}`} />}<Result label={tSide === "buy" ? "You pay" : "You receive"} value={rs(tNet)} tone={tSide === "buy" ? undefined : "positive"} /><Result label="Per share, all in" value={`Rs ${(tNet / Math.max(1, tQty)).toFixed(3)}`} /></div>
      </Calc>
      <Calc eyebrow="Payout" title="Dividend after withholding">
        <div className="space-y-3"><Field label="Shares" value={dShares} onChange={setDShares} /><Field label="Dividend per share" value={dRate} onChange={setDRate} suffix="Rs" /><label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={dZakat} onChange={(e) => setDZakat(e.target.checked)} /> Zakat deducted at source (2.5%)</label></div>
        <div><Result label="Gross" value={rs(dGross)} /><Result label={`Withholding (${divWht}%)`} value={`Rs ${dWht.toFixed(2)}`} />{dZakat && <Result label="Zakat" value={`Rs ${dZ.toFixed(2)}`} />}<Result label="Net paid" value={rs(dGross - dWht - dZ)} tone="positive" /></div>
      </Calc>
      <Calc eyebrow="Value" title="Peter Lynch fair value">
        <div className="space-y-3"><Field label="Earnings per share" value={plEps} onChange={setPlEps} suffix="Rs" /><Field label="Earnings growth" value={plGrowth} onChange={setPlGrowth} suffix="% a year" /><Field label="Dividend yield" value={plYield} onChange={setPlYield} suffix="%" /><Field label="Price" value={plPrice} onChange={setPlPrice} suffix="Rs" /></div>
        <div><Result label="Fair P/E (growth + yield)" value={`${(plGrowth + plYield).toFixed(1)}×`} /><Result label="Fair value" value={rs(plValue)} /><Result label="Price against it" value={pct((plPrice / plValue - 1) * 100)} tone={plPrice <= plValue ? "positive" : "negative"} /><Result label="PEG (P/E over growth+yield)" value={peg.toFixed(2)} tone={peg <= 1 ? "positive" : peg >= 2 ? "negative" : undefined} /></div>
      </Calc>
      <Calc eyebrow="Value" title="Discounted cash flow, per share">
        <div className="space-y-3"><Field label="Free cash flow per share now" value={fcf} onChange={setFcf} suffix="Rs" /><Field label="Growth for the first years" value={g1} onChange={setG1} suffix="%" /><Field label="Those years" value={dcfYears} onChange={setDcfYears} /><Field label="Growth after" value={gT} onChange={setGT} suffix="%" /><Field label="Discount rate" value={disc} onChange={setDisc} suffix="%" /></div>
        <div><Result label="Value of the first years" value={rs(dcf)} /><Result label="Terminal value, discounted" value={rs(terminal)} /><Result label="Value per share" value={rs(dcfValue)} tone="positive" /><div className="text-[11px] text-muted mt-2">A discount rate near the 12-month T-bill plus a few points is the usual Pakistani hurdle; small changes in it move the answer a lot, so treat this as a range.</div></div>
      </Calc>
      <Calc eyebrow="Risk" title="Drawdown recovery">
        <div className="space-y-3"><Field label="Loss" value={ddLoss} onChange={setDdLoss} suffix="%" /></div>
        <div><Result label="Gain needed to get back" value={pct(recover, 1)} tone="negative" /><div className="text-[11px] text-muted mt-2">A 50% loss needs a 100% gain; the asymmetry is the whole case for the fail levels.</div></div>
      </Calc>
      <Calc eyebrow="Risk" title="Position size from a stop">
        <div className="space-y-3"><Field label="Book" value={psBook} onChange={setPsBook} suffix="Rs" /><Field label="Risk per position" value={psRisk} onChange={setPsRisk} suffix="% of book" /><Field label="Entry" value={psEntry} onChange={setPsEntry} suffix="Rs" /><Field label="Fail level (stop)" value={psStop} onChange={setPsStop} suffix="Rs" /></div>
        <div><Result label="Risk per share" value={`Rs ${perShareRisk.toFixed(2)}`} /><Result label="Shares" value={psShares.toLocaleString()} tone="positive" /><Result label="Position" value={rs(psShares * psEntry)} /><Result label="Weight of the book" value={pct(((psShares * psEntry) / psBook) * 100, 1)} /></div>
      </Calc>
      <Calc eyebrow="Zakat" title="Zakat on wealth">
        <div className="space-y-3"><Field label="Zakatable assets" value={zBase} onChange={setZBase} suffix="Rs" /><Field label="Debts due" value={zDebts} onChange={setZDebts} suffix="Rs" /></div>
        <div><Result label="Net base" value={rs(Math.max(0, zBase - zDebts))} /><Result label="Zakat at 2.5%" value={rs(zakat)} tone="positive" /></div>
      </Calc>
    </div>
  );
}
