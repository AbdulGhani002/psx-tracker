"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fmtRs } from "@/lib/format";
import { depositFace, tbillCost } from "@/lib/fixed-income/value";

// The cash side of Add trade: a fixed deposit, money into or out of a bank
// account, a T-bill or a sukuk, or the brokerage account. A money-market fund
// is the mutual fund form (AddTradeForm). All of it is cash: the overview's
// cash and the strategy's dry powder count it.

export type CashKind = "mmf" | "fd" | "bank" | "tbill" | "broker";
export const CASH_KINDS: Array<{ key: CashKind; label: string }> = [
  { key: "mmf", label: "Money market fund" },
  { key: "fd", label: "Fixed deposit" },
  { key: "bank", label: "Bank account" },
  { key: "tbill", label: "T-bill / sukuk" },
  { key: "broker", label: "Broker cash" },
];

export type CashAccount = { _id: string; name: string; bank: string; balance: number; ratePercent: number };

const today = () => new Date().toISOString().slice(0, 10);

function addMonths(iso: string, months: number): string {
  const d = new Date(iso + "T00:00:00Z");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[12px] font-medium mb-1.5">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-muted mt-1">{hint}</div>}
    </div>
  );
}

function Choice({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Array<[string, string]> }) {
  return (
    <div className="field !min-h-[38px] relative">
      <select value={value} onChange={(e) => onChange(e.target.value)} className="!py-1 text-[13px]">
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
      <svg className="field-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
    </div>
  );
}

function Strip({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 rounded-lg p-3" style={{ background: "var(--surface-2)" }}>
      {items.map(([l, v]) => (
        <div key={l}><div className="label-cap">{l}</div><div className="mono-num font-semibold mt-0.5">{v}</div></div>
      ))}
    </div>
  );
}

function Footer({ busy, label, error, onSubmit }: { busy: boolean; label: string; error: string | null; onSubmit: () => void }) {
  const router = useRouter();
  return (
    <>
      {error && <div className="text-[12.5px] mt-3 rounded-lg px-3 py-2" style={{ color: "var(--negative)", background: "#fef2f2" }}>{error}</div>}
      <div className="flex items-center gap-2 mt-4">
        <button type="button" onClick={onSubmit} disabled={busy} className="btn-primary">{busy ? "Saving…" : label}</button>
        <button type="button" className="btn-ghost" onClick={() => router.back()}>Cancel</button>
      </div>
    </>
  );
}

// Posts, and on success goes to the Cash tab.
function useSave() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(url: string, method: "POST" | "PATCH", body: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b?.issues?.[0]?.message ?? b?.detail ?? b?.error ?? "Could not save it.");
        return;
      }
      router.push("/portfolio?tab=cash");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, save };
}

const TENORS: Array<[string, string]> = [["1", "1 month"], ["3", "3 months"], ["6", "6 months"], ["12", "1 year"], ["24", "2 years"], ["36", "3 years"], ["60", "5 years"], ["date", "Another date"]];
const PAYOUTS: Array<[string, string]> = [["12", "Monthly"], ["4", "Quarterly"], ["2", "Half-yearly"], ["1", "Yearly"], ["0", "At maturity"]];

export function FixedDepositForm({ taxPct, portfolioId }: { taxPct: number; portfolioId: string }) {
  const { busy, error, setError, save } = useSave();
  const [bank, setBank] = useState("");
  const [amount, setAmount] = useState(0);
  const [rate, setRate] = useState(0);
  const [start, setStart] = useState(today());
  const [tenor, setTenor] = useState("12");
  const [maturity, setMaturity] = useState("");
  const [payout, setPayout] = useState("12");
  const [tax, setTax] = useState(taxPct);
  const [notes, setNotes] = useState("");

  const ends = tenor === "date" ? maturity : addMonths(start, Number(tenor));
  const per = Number(payout);
  const face = ends && amount > 0 && rate > 0 ? depositFace(amount, rate, start, ends, per) : 0;
  const profitEach = per > 0 ? (amount * rate) / 100 / per : face - amount;
  const after = (v: number) => v * (1 - tax / 100);

  function submit() {
    if (!(amount > 0)) return setError("Enter the amount deposited.");
    if (!(rate > 0)) return setError("Enter the profit rate.");
    if (!ends || ends <= start) return setError("Enter when it matures.");
    save("/api/fixed-income", "POST", { kind: "fd", name: `${bank.trim() || "Bank"} FD`, cost: amount, couponPct: rate, couponsPerYear: per, purchaseDate: start, maturityDate: ends, taxPct: tax, notes, ...(portfolioId ? { portfolioId } : {}) });
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <Field label="Bank">
          <input value={bank} onChange={(e) => setBank(e.target.value)} className="field" placeholder="e.g. Meezan Bank" />
        </Field>
        <Field label="Amount deposited (Rs)">
          <input type="number" min={0} step={10000} value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} className="field mono-num" placeholder="0" />
        </Field>
        <Field label="Profit rate (% a year)">
          <input type="number" min={0} max={100} step={0.01} value={rate || ""} onChange={(e) => setRate(Number(e.target.value))} className="field mono-num" placeholder="0.00" />
        </Field>
        <Field label="Profit paid">
          <Choice value={payout} onChange={setPayout} options={PAYOUTS} />
        </Field>
        <Field label="Start date">
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="field mono-num" />
        </Field>
        <Field label="Term" hint={tenor !== "date" && ends ? `Matures ${ends}` : undefined}>
          <Choice value={tenor} onChange={setTenor} options={TENORS} />
        </Field>
        {tenor === "date" && (
          <Field label="Matures on">
            <input type="date" value={maturity} onChange={(e) => setMaturity(e.target.value)} className="field mono-num" />
          </Field>
        )}
        <Field label="Tax withheld on the profit (%)">
          <input type="number" min={0} max={100} step={0.5} value={tax} onChange={(e) => setTax(Number(e.target.value))} className="field mono-num" />
        </Field>
        <div className="md:col-span-2">
          <Field label="Notes">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="field" placeholder="Optional" />
          </Field>
        </div>
      </div>
      <Strip
        items={[
          [per > 0 ? `Profit ${PAYOUTS.find(([v]) => v === payout)?.[1].toLowerCase()}` : "Profit at maturity", profitEach > 0 ? fmtRs(profitEach) : "–"],
          ["After tax", profitEach > 0 ? fmtRs(after(profitEach)) : "–"],
          ["Back at maturity", face > 0 ? fmtRs(face) : "–"],
          ["Matures", ends || "–"],
        ]}
      />
      <Footer busy={busy} error={error} label="Record deposit" onSubmit={submit} />
    </>
  );
}

export function BankForm({ accounts, portfolioId }: { accounts: CashAccount[]; portfolioId: string }) {
  const { busy, error, setError, save } = useSave();
  const [accountId, setAccountId] = useState(accounts[0]?._id ?? "new");
  const [type, setType] = useState<"DEPOSIT" | "WITHDRAWAL">("DEPOSIT");
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(today());
  const [name, setName] = useState("");
  const [bank, setBank] = useState("");
  const [rate, setRate] = useState(0);
  const [note, setNote] = useState("");
  const account = accounts.find((a) => a._id === accountId) ?? null;
  const isNew = !account;

  function submit() {
    if (!(amount > 0)) return setError(isNew ? "Enter the balance." : "Enter the amount.");
    if (isNew) {
      if (!name.trim()) return setError("Name the account.");
      return save("/api/savings", "POST", { name: name.trim(), bank: bank.trim(), ratePercent: rate, anchorDate: date, anchorBalance: amount, notes: note, ...(portfolioId ? { portfolioId } : {}) });
    }
    if (type === "WITHDRAWAL" && amount > account.balance + 0.5) return setError(`That is more than the ${fmtRs(account.balance)} in it.`);
    save(`/api/savings/${account._id}`, "PATCH", { addMovement: { date, type, amount, note } });
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <Field label="Account">
          <Choice value={accountId} onChange={setAccountId} options={[...accounts.map((a) => [a._id, `${a.name} · ${fmtRs(a.balance)}`] as [string, string]), ["new", "A new account"]]} />
        </Field>
        {isNew ? (
          <Field label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} className="field" placeholder="e.g. Bank Alfalah Alfa" />
          </Field>
        ) : (
          <Field label="Money">
            <div className="seg">
              <button type="button" data-active={type === "DEPOSIT"} onClick={() => setType("DEPOSIT")}>In</button>
              <button type="button" data-active={type === "WITHDRAWAL"} onClick={() => setType("WITHDRAWAL")}>Out</button>
            </div>
          </Field>
        )}
        {isNew && (
          <>
            <Field label="Bank">
              <input value={bank} onChange={(e) => setBank(e.target.value)} className="field" placeholder="Optional" />
            </Field>
            <Field label="Profit rate (% a year)" hint="0 for a current account.">
              <input type="number" min={0} max={100} step={0.01} value={rate || ""} onChange={(e) => setRate(Number(e.target.value))} className="field mono-num" placeholder="0.00" />
            </Field>
          </>
        )}
        <Field label={isNew ? "Balance now (Rs)" : "Amount (Rs)"}>
          <input type="number" min={0} step={1000} value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} className="field mono-num" placeholder="0" />
        </Field>
        <Field label="Date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field mono-num" />
        </Field>
        <div className="md:col-span-2">
          <Field label="Note">
            <input value={note} onChange={(e) => setNote(e.target.value)} className="field" placeholder="Optional" />
          </Field>
        </div>
      </div>
      {!isNew && amount > 0 && <Strip items={[["Balance now", fmtRs(account.balance)], ["After this", fmtRs(account.balance + (type === "DEPOSIT" ? amount : -amount))]]} />}
      <Footer busy={busy} error={error} label={isNew ? "Add account" : type === "DEPOSIT" ? "Record money in" : "Record money out"} onSubmit={submit} />
    </>
  );
}

export function BillSukukForm({ taxPct, portfolioId }: { taxPct: number; portfolioId: string }) {
  const { busy, error, setError, save } = useSave();
  const [kind, setKind] = useState<"tbill" | "sukuk">("tbill");
  const [face, setFace] = useState(0);
  const [tenor, setTenor] = useState("12");
  const [yieldPct, setYieldPct] = useState(0);
  const [cost, setCost] = useState(0);
  const [bought, setBought] = useState(today());
  const [maturity, setMaturity] = useState("");
  const [coupon, setCoupon] = useState(0);
  const [perYear, setPerYear] = useState("2");
  const [tax, setTax] = useState(taxPct);
  const ends = kind === "tbill" && !maturity ? addMonths(bought, Number(tenor)) : maturity;
  const days = ends ? Math.max(1, Math.round((Date.parse(ends) - Date.parse(bought)) / 86400000)) : 0;
  const paid = kind === "tbill" ? (yieldPct > 0 && face > 0 && days > 0 ? tbillCost(face, yieldPct, days) : 0) : cost;
  const name = kind === "tbill" ? `${tenor}M T-bill` : "GoP Ijara Sukuk";
  const items = useMemo<Array<[string, string]>>(
    () =>
      kind === "tbill"
        ? [["You pay", paid > 0 ? fmtRs(paid) : "–"], ["Back at maturity", face > 0 ? fmtRs(face) : "–"], ["Profit", paid > 0 ? fmtRs(face - paid) : "–"], ["Matures", ends || "–"]]
        : [["Each payment", face > 0 && coupon > 0 ? fmtRs((face * coupon) / 100 / Number(perYear)) : "–"], ["After tax", face > 0 && coupon > 0 ? fmtRs(((face * coupon) / 100 / Number(perYear)) * (1 - tax / 100)) : "–"], ["Back at maturity", face > 0 ? fmtRs(face) : "–"], ["Matures", ends || "–"]],
    [kind, paid, face, ends, coupon, perYear, tax]
  );

  function submit() {
    if (!(face > 0)) return setError("Enter the face value.");
    if (kind === "tbill" && !(yieldPct > 0)) return setError("Enter the yield you bought at.");
    if (kind === "sukuk" && !(cost > 0)) return setError("Enter what you paid.");
    if (!ends || ends <= bought) return setError("Enter when it matures.");
    save("/api/fixed-income", "POST", {
      kind,
      name,
      face,
      purchaseDate: bought,
      maturityDate: ends,
      taxPct: tax,
      ...(kind === "tbill" ? { yieldPct } : { cost, couponPct: coupon, couponsPerYear: Number(perYear) }),
      ...(portfolioId ? { portfolioId } : {}),
    });
  }

  return (
    <>
      <div className="seg mt-4">
        <button type="button" data-active={kind === "tbill"} onClick={() => setKind("tbill")}>T-bill</button>
        <button type="button" data-active={kind === "sukuk"} onClick={() => setKind("sukuk")}>Sukuk</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <Field label="Face value (Rs)" hint="What it repays at maturity.">
          <input type="number" min={0} step={10000} value={face || ""} onChange={(e) => setFace(Number(e.target.value))} className="field mono-num" placeholder="0" />
        </Field>
        <Field label="Bought on">
          <input type="date" value={bought} onChange={(e) => setBought(e.target.value)} className="field mono-num" />
        </Field>
        {kind === "tbill" ? (
          <>
            <Field label="Tenor">
              <Choice value={tenor} onChange={setTenor} options={[["1", "1 month"], ["3", "3 months"], ["6", "6 months"], ["12", "12 months"]]} />
            </Field>
            <Field label="Yield bought at (%)">
              <input type="number" min={0} max={100} step={0.01} value={yieldPct || ""} onChange={(e) => setYieldPct(Number(e.target.value))} className="field mono-num" placeholder="0.00" />
            </Field>
          </>
        ) : (
          <>
            <Field label="Paid (Rs)" hint="Fees included.">
              <input type="number" min={0} step={1000} value={cost || ""} onChange={(e) => setCost(Number(e.target.value))} className="field mono-num" placeholder="0" />
            </Field>
            <Field label="Profit rate (% a year)">
              <input type="number" min={0} max={100} step={0.01} value={coupon || ""} onChange={(e) => setCoupon(Number(e.target.value))} className="field mono-num" placeholder="0.00" />
            </Field>
            <Field label="Payments a year">
              <Choice value={perYear} onChange={setPerYear} options={[["2", "Twice (half-yearly)"], ["4", "Four times"], ["1", "Once"], ["12", "Monthly"]]} />
            </Field>
          </>
        )}
        <Field label={kind === "tbill" ? "Matures on (optional)" : "Matures on"}>
          <input type="date" value={maturity} onChange={(e) => setMaturity(e.target.value)} className="field mono-num" />
        </Field>
        <Field label="Tax withheld on the profit (%)">
          <input type="number" min={0} max={100} step={0.5} value={tax} onChange={(e) => setTax(Number(e.target.value))} className="field mono-num" />
        </Field>
      </div>
      <Strip items={items} />
      <Footer busy={busy} error={error} label={kind === "tbill" ? "Record T-bill" : "Record sukuk"} onSubmit={submit} />
    </>
  );
}

export function BrokerCashForm({ portfolioId }: { portfolioId: string }) {
  const { busy, error, setError, save } = useSave();
  const [type, setType] = useState<"DEPOSIT" | "WITHDRAWAL">("DEPOSIT");
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");

  function submit() {
    if (!(amount > 0)) return setError("Enter the amount.");
    save("/api/cash", "POST", { type, amount, date, notes, ...(portfolioId ? { portfolioId } : {}) });
  }

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <Field label="Money">
          <div className="seg">
            <button type="button" data-active={type === "DEPOSIT"} onClick={() => setType("DEPOSIT")}>Deposit</button>
            <button type="button" data-active={type === "WITHDRAWAL"} onClick={() => setType("WITHDRAWAL")}>Withdraw</button>
          </div>
        </Field>
        <Field label="Amount (Rs)">
          <input type="number" min={0} step={1000} value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} className="field mono-num" placeholder="0" />
        </Field>
        <Field label="Date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="field mono-num" />
        </Field>
        <Field label="Note">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className="field" placeholder="Optional" />
        </Field>
      </div>
      <Footer busy={busy} error={error} label={type === "DEPOSIT" ? "Record deposit" : "Record withdrawal"} onSubmit={submit} />
    </>
  );
}
