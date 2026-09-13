import { Card } from "@/components/ui/Card";
import { ZakatForm, DeleteZakat } from "./ZakatForm";
import { getAllTransactions, getNetWorth, getCashSummary, getZakatPayments } from "@/lib/data";
import { currentTaxYear, taxYearOf } from "@/lib/dates";
import { fmtRs, fmtDate } from "@/lib/format";

// Zakat the way Zar lays it out: dividend zakat plus portfolio zakat equals
// the total, then the payments recorded against it.
export async function ZakatTab({ title = "Zakat" }: { title?: string }) {
  const cur = currentTaxYear();
  const [txs, nw, cashSum, payments] = await Promise.all([getAllTransactions(), getNetWorth().catch(() => null), getCashSummary().catch(() => null), getZakatPayments()]);
  const inYear = txs.filter((t) => t.type === "DIVIDEND" && taxYearOf(t.date).endYear === cur.endYear);
  const dividendZakat = inYear.reduce((s, t) => s + (t.zakatDeducted ?? 0), 0);
  const brokerCash = Math.max(0, cashSum?.balance ?? 0);
  const base = nw ? nw.equity + nw.funds + nw.savings + brokerCash : 0;
  const portfolioZakat = base * 0.025;
  const total = dividendZakat + portfolioZakat;
  const paid = payments.reduce((s, p) => s + p.amount, 0);

  return (
    <div>
      <Card>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[16px] font-semibold">{title}</div>
          <ZakatForm />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr] gap-3 items-center mt-4 rounded-lg p-4" style={{ background: "var(--surface-2)" }}>
          <div className="text-center">
            <div className="label-cap">Dividend zakat</div>
            <div className="fig text-[18px] mt-1">{fmtRs(dividendZakat)}</div>
            <div className="text-[11px] text-muted mt-0.5">Deducted at source, {cur.label}</div>
          </div>
          <div className="text-center text-muted text-[18px]">+</div>
          <div className="text-center">
            <div className="label-cap">Total portfolio zakat</div>
            <div className="fig text-[18px] mt-1">{fmtRs(portfolioZakat)}</div>
            <div className="text-[11px] text-muted mt-0.5">2.5% of {fmtRs(base)} at today&apos;s values</div>
          </div>
          <div className="text-center text-muted text-[18px]">=</div>
          <div className="text-center">
            <div className="label-cap">Total zakat</div>
            <div className="fig text-[18px] mt-1">{fmtRs(total)}</div>
            <div className="text-[11px] text-muted mt-0.5">{paid > 0 ? `Recorded paid ${fmtRs(paid)}` : "Nothing recorded as paid yet"}</div>
          </div>
        </div>

        <div className="mt-4">
          {payments.length === 0 ? (
            <div className="text-[12px] text-muted">No payments recorded.</div>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="table-zar">
                <thead><tr><th>Date</th><th className="text-right">Zakat</th><th>Comments</th><th></th></tr></thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p._id}>
                      <td className="mono-num">{fmtDate(p.date)}</td>
                      <td className="text-right mono-num font-medium">{fmtRs(p.amount)}</td>
                      <td className="text-muted">{p.notes}</td>
                      <td className="text-right"><DeleteZakat id={p._id} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mt-3">
        <Card title="Zakatable base" eyebrow="At today's values">
          <table className="table-zar">
            <tbody>
              <tr><td>Shares at market</td><td className="text-right mono-num">{fmtRs(nw?.equity ?? 0)}</td></tr>
              <tr><td>Money-market funds</td><td className="text-right mono-num">{fmtRs(nw?.funds ?? 0)}</td></tr>
              <tr><td>Savings</td><td className="text-right mono-num">{fmtRs(nw?.savings ?? 0)}</td></tr>
              <tr><td>Brokerage cash</td><td className="text-right mono-num">{fmtRs(brokerCash)}</td></tr>
              <tr><td className="font-semibold">Base</td><td className="text-right mono-num font-semibold">{fmtRs(base)}</td></tr>
              <tr><td className="font-semibold">Zakat at 2.5%</td><td className="text-right mono-num font-semibold" style={{ color: "var(--accent-deep)" }}>{fmtRs(portfolioZakat)}</td></tr>
            </tbody>
          </table>
        </Card>
        <Card title="How to read it" eyebrow="An estimate, not a ruling">
          <p className="text-[13px] text-muted leading-relaxed">
            Zakat falls due on your own anniversary date at that day&apos;s values, on what you have held for a lunar year, less debts due. Companies and funds deduct 2.5% from payouts at source unless a declaration is on file, so the dividend figure here is what was already paid for you. Record what you pay yourself with the button above so the two add up.
          </p>
        </Card>
      </div>
    </div>
  );
}
