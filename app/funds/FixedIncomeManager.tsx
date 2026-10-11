"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { NumberInput } from "@/components/ui/NumberInput";
import { TextInput } from "@/components/ui/TextInput";
import { Select } from "@/components/ui/Select";
import { fmtRs, fmtDate } from "@/lib/format";

// T-bills, sukuks and fixed deposits held: add a T-bill (by the yield it was
// bought at or the price paid) or a sukuk (by its price, profit rate and
// payments a year) here, a deposit from Add trade; see what each is worth
// today and has earned, set a sukuk's market price, take one off once it has
// matured or been sold.

type Row = {
  _id: string;
  kind: "tbill" | "sukuk" | "fd";
  name: string;
  face: number;
  cost: number;
  purchaseDate: string;
  maturityDate: string;
  couponPct: number;
  couponsPerYear: number;
  taxPct: number;
  pricePct: number | null;
  value: number;
  profitSoFar: number;
  couponsPaid: number;
  yieldPct: number;
  afterTaxYieldPct: number;
  daysLeft: number;
  matured: boolean;
  nextCouponDate: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);

export function FixedIncomeManager({ rows, taxPct }: { rows: Row[]; taxPct: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"tbill" | "sukuk">("tbill");
  const [name, setName] = useState("12M T-bill");
  const [face, setFace] = useState(0);
  const [priceBy, setPriceBy] = useState<"yield" | "cost">("yield");
  const [yieldPct, setYieldPct] = useState(0);
  const [cost, setCost] = useState(0);
  const [tenor, setTenor] = useState("12");
  const [purchaseDate, setPurchaseDate] = useState(today());
  const [maturityDate, setMaturityDate] = useState("");
  const [couponPct, setCouponPct] = useState(0);
  const [couponsPerYear, setCouponsPerYear] = useState("2");
  const [tax, setTax] = useState(taxPct);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickKind(k: "tbill" | "sukuk") {
    setKind(k);
    setName(k === "tbill" ? `${tenor}M T-bill` : "GoP Ijara Sukuk");
    if (k === "sukuk") setPriceBy("cost");
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!(face > 0)) return setError("Enter the face value.");
    if (kind === "sukuk" && !maturityDate) return setError("Enter the sukuk's maturity date.");
    if (priceBy === "yield" ? !(yieldPct > 0) : !(cost > 0)) return setError(priceBy === "yield" ? "Enter the yield you bought at." : "Enter what you paid.");
    setSaving(true);
    try {
      const body: Record<string, unknown> = { kind, name, face, purchaseDate, taxPct: tax };
      if (priceBy === "yield" && kind === "tbill") body.yieldPct = yieldPct;
      else body.cost = cost;
      if (kind === "tbill" && !maturityDate) body.tenorMonths = Number(tenor);
      else body.maturityDate = maturityDate;
      if (kind === "sukuk") {
        body.couponPct = couponPct;
        body.couponsPerYear = Number(couponsPerYear);
      }
      const res = await fetch("/api/fixed-income", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b?.detail ?? b?.issues?.[0]?.message ?? b?.error ?? "Failed.");
        return;
      }
      setOpen(false);
      setFace(0);
      setCost(0);
      setYieldPct(0);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Take this off the list? Do it once it has matured or been sold.")) return;
    await fetch(`/api/fixed-income/${id}`, { method: "DELETE" });
    router.refresh();
  }

  async function setPrice(r: Row) {
    const v = prompt("Market price, % of face (blank to carry it at cost):", r.pricePct != null ? String(r.pricePct) : "");
    if (v == null) return;
    const pricePct = v.trim() === "" ? null : Number(v);
    if (pricePct != null && !(pricePct > 0)) return;
    await fetch(`/api/fixed-income/${r._id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ pricePct }) });
    router.refresh();
  }

  const held = rows.filter((r) => !r.matured);
  const total = held.reduce((s, r) => s + r.value, 0);
  const profit = held.reduce((s, r) => s + r.profitSoFar, 0);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <div className="label-cap">
          {held.length} held{held.length > 0 ? ` · worth ${fmtRs(total)} · earned ${fmtRs(profit)} so far` : ""}
        </div>
        <Button variant={open ? "outline" : "solid"} onClick={() => setOpen(!open)}>
          {open ? "Close" : "Add T-bill or sukuk"}
        </Button>
      </div>

      {open && (
        <Card>
          <form onSubmit={add} className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-4">
            <div className="md:col-span-3">
              <div className="seg">
                <button type="button" data-active={kind === "tbill"} onClick={() => pickKind("tbill")}>T-bill</button>
                <button type="button" data-active={kind === "sukuk"} onClick={() => pickKind("sukuk")}>Sukuk</button>
              </div>
            </div>
            <TextInput label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <NumberInput label="Face value (Rs)" value={face} onChange={setFace} min={0} step={1000} hint={kind === "tbill" ? "What it pays at maturity." : "What it repays at maturity."} />
            <div className="space-y-1.5">
              <label className="label-cap block">Bought on</label>
              <div className="border-b border-ink">
                <input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} className="w-full bg-transparent text-[14px] py-1.5 font-mono mono-num focus:outline-none" />
              </div>
            </div>

            {kind === "tbill" ? (
              <>
                <Select label="Tenor" value={tenor} onChange={(v) => { setTenor(v); setName(`${v}M T-bill`); }} options={[{ value: "1", label: "1 month" }, { value: "3", label: "3 months" }, { value: "6", label: "6 months" }, { value: "12", label: "12 months" }]} hint="Or set the maturity date." />
                <div className="space-y-1.5">
                  <div className="seg">
                    <button type="button" data-active={priceBy === "yield"} onClick={() => setPriceBy("yield")}>By yield</button>
                    <button type="button" data-active={priceBy === "cost"} onClick={() => setPriceBy("cost")}>By price paid</button>
                  </div>
                  {priceBy === "yield" ? (
                    <NumberInput label="Yield bought at (%)" value={yieldPct} onChange={setYieldPct} min={0} max={100} step={0.01} suffix="%" />
                  ) : (
                    <NumberInput label="Paid (Rs)" value={cost} onChange={setCost} min={0} step={100} />
                  )}
                </div>
              </>
            ) : (
              <>
                <NumberInput label="Paid (Rs)" value={cost} onChange={setCost} min={0} step={100} hint="Fees included." />
                <NumberInput label="Profit rate (% a year)" value={couponPct} onChange={setCouponPct} min={0} max={100} step={0.01} suffix="%" />
                <Select label="Payments a year" value={couponsPerYear} onChange={setCouponsPerYear} options={[{ value: "2", label: "Twice (half-yearly)" }, { value: "4", label: "Four times" }, { value: "1", label: "Once" }, { value: "12", label: "Monthly" }]} />
              </>
            )}
            <div className="space-y-1.5">
              <label className="label-cap block">Matures on{kind === "tbill" ? " (optional)" : ""}</label>
              <div className="border-b border-ink">
                <input type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} className="w-full bg-transparent text-[14px] py-1.5 font-mono mono-num focus:outline-none" />
              </div>
            </div>
            <NumberInput label="Tax withheld on the profit (%)" value={tax} onChange={setTax} min={0} max={100} step={0.5} suffix="%" />
            <div className="flex items-end gap-3 md:col-span-3">
              <Button type="submit" variant="solid" disabled={saving}>{saving ? "Saving…" : "Add"}</Button>
              {error && <span className="text-[13px]" style={{ color: "var(--negative)" }}>{error}</span>}
            </div>
          </form>
        </Card>
      )}

      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">None yet.</p>
        </Card>
      ) : (
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="table-zar">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="text-right">Face</th>
                  <th className="text-right">Paid</th>
                  <th className="text-right">Yield</th>
                  <th>Matures</th>
                  <th className="text-right">Worth today</th>
                  <th className="text-right">Earned so far</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r._id} style={r.matured ? { opacity: 0.55 } : undefined}>
                    <td>
                      <div className="font-semibold">{r.name}</div>
                      <div className="text-[11px] text-muted">
                        {r.kind === "tbill" ? "T-bill" : `${r.kind === "fd" ? "Fixed deposit" : "Sukuk"}, ${r.couponPct}% ${r.couponsPerYear === 2 ? "half-yearly" : r.couponsPerYear === 4 ? "quarterly" : r.couponsPerYear === 12 ? "monthly" : r.couponsPerYear === 0 ? "at maturity" : "a year"}`}
                        {r.nextCouponDate ? ` · next payment ${fmtDate(r.nextCouponDate)}` : ""}
                        {r.pricePct != null ? ` · at ${r.pricePct}%` : ""}
                      </div>
                    </td>
                    <td className="text-right mono-num">{fmtRs(r.face)}</td>
                    <td className="text-right mono-num">{fmtRs(r.cost)}</td>
                    <td className="text-right mono-num" title={`${r.afterTaxYieldPct.toFixed(2)}% after ${r.taxPct}% tax`}>{r.yieldPct.toFixed(2)}%</td>
                    <td className="whitespace-nowrap">
                      {fmtDate(r.maturityDate)}
                      <div className="text-[11px] text-muted">{r.matured ? "matured" : `${r.daysLeft} days`}</div>
                    </td>
                    <td className="text-right mono-num">{fmtRs(r.value)}</td>
                    <td className="text-right mono-num" style={{ color: "var(--positive)" }} title={r.couponsPaid > 0 ? `${fmtRs(r.couponsPaid)} of it paid out` : undefined}>{fmtRs(r.profitSoFar)}</td>
                    <td className="text-right whitespace-nowrap">
                      {r.kind === "sukuk" && !r.matured && <button type="button" className="text-[12px] link-underline mr-3" onClick={() => setPrice(r)}>Price</button>}
                      <button type="button" className="text-[12px] link-underline" style={{ color: "var(--negative)" }} onClick={() => remove(r._id)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
