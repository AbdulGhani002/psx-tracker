import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { uid } from "@/lib/auth/uid";
import { APP_VERSION } from "@/lib/version";
import {
  DecisionModel,
  HoldingModel,
  TransactionModel,
  ScenarioProjectionModel,
  TargetAllocationModel,
  DecisionLogModel,
  CashEntryModel,
  WatchlistEntryModel,
  MutualFundModel,
  SavingsAccountModel,
  AppSettingsModel,
  CommodityTradeModel,
} from "@/lib/models";

export const dynamic = "force-dynamic";

// Every collection in the app, in a restore-safe order (settings + reference
// data first). Each entry maps a stable name (used in the backup file) to its
// Mongoose model.
// Only the signed-in user's own collections — global/market data (prices,
// fundamentals, SBP rates, alerts) is shared and never part of a user's backup.
const COLLECTIONS: Array<{ name: string; model: any }> = [
  { name: "AppSettings", model: AppSettingsModel },
  { name: "TargetAllocation", model: TargetAllocationModel },
  { name: "WatchlistEntry", model: WatchlistEntryModel },
  { name: "Holding", model: HoldingModel },
  { name: "Transaction", model: TransactionModel },
  { name: "CashEntry", model: CashEntryModel },
  { name: "DecisionLog", model: DecisionLogModel },
  { name: "Decision", model: DecisionModel },
  { name: "MutualFund", model: MutualFundModel },
  { name: "SavingsAccount", model: SavingsAccountModel },
  { name: "CommodityTrade", model: CommodityTradeModel },
  { name: "ScenarioProjection", model: ScenarioProjectionModel },
];

const MAX_RESTORE_BYTES = 50 * 1024 * 1024; // 50 MB

// GET /api/backup — download a full JSON snapshot of every collection.
// Includes soft-deleted transactions so the backup is lossless.
export async function GET() {
  await connectDb();
  const u = await uid();
  const collections: Record<string, unknown[]> = {};
  let totalDocs = 0;
  for (const c of COLLECTIONS) {
    const docs = await c.model.find({ userId: u }).lean();
    collections[c.name] = docs;
    totalDocs += docs.length;
  }

  const payload = {
    app: "psx-tracker-v2",
    schemaVersion: 1,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    totalDocs,
    collections,
  };

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="psx-backup-${stamp}.json"`,
      "cache-control": "no-store",
    },
  });
}

const restoreSchema = z.object({
  mode: z.enum(["replace", "merge"]).default("replace"),
  confirm: z.string().optional(),
  collections: z.record(z.array(z.record(z.any()))),
});

// Fields that carry a unique (or partial-unique) index per collection. We
// pre-validate the backup against these BEFORE writing anything, so a file that
// would violate a constraint is rejected instead of half-applied.
const UNIQUE_FIELDS: Record<string, string[]> = {
  Holding: ["symbol"],
  TargetAllocation: ["symbol"],
  WatchlistEntry: ["symbol"],
  SbpRate: ["effectiveDate"],
  AlertLog: ["dedupeKey"],
  Transaction: ["warrantNo"], // partial: only string values are unique
};

function validateRows(name: string, rows: Array<Record<string, unknown>>): string[] {
  const issues: string[] = [];

  // Duplicate _id within the same collection would make restore non-deterministic.
  const ids = new Set<string>();
  for (const r of rows) {
    const id = r?._id != null ? String(r._id) : null;
    if (!id) continue;
    if (ids.has(id)) issues.push(`${name}: duplicate _id ${id}`);
    ids.add(id);
  }

  for (const field of UNIQUE_FIELDS[name] ?? []) {
    const seen = new Set<string>();
    for (const r of rows) {
      const v = r?.[field];
      if (v == null || v === "") continue; // partial/sparse: blanks don't collide
      const key = String(v);
      if (seen.has(key)) issues.push(`${name}: duplicate ${field} "${key}"`);
      seen.add(key);
    }
  }

  // AppSettings is a singleton.
  if (name === "AppSettings" && rows.length > 1) {
    issues.push(`AppSettings: expected at most 1 document, found ${rows.length}`);
  }

  return issues;
}

// POST /api/backup — restore from a backup file.
//  mode "replace" (default): wipe each known collection, then load the file's
//    rows. Requires { confirm: "REPLACE" } because it is destructive. Each
//    collection is snapshotted first and rolled back if its reload throws, so a
//    failed restore never leaves a collection wiped-but-empty.
//  mode "merge": upsert each row by _id, leaving anything not in the file alone.
// Original createdAt/updatedAt are preserved in both modes (timestamps: false).
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    if (raw.length > MAX_RESTORE_BYTES) {
      return NextResponse.json({ error: "file_too_large" }, { status: 413 });
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
    const parsed = restoreSchema.parse(body);

    if (parsed.mode === "replace" && parsed.confirm !== "REPLACE") {
      return NextResponse.json(
        { error: "confirm_required", detail: 'Send {"confirm":"REPLACE"} to overwrite existing data.' },
        { status: 400 }
      );
    }

    // Pre-flight: reject a structurally-bad backup before touching the DB.
    const issues: string[] = [];
    for (const c of COLLECTIONS) {
      const rows = parsed.collections[c.name];
      if (Array.isArray(rows)) issues.push(...validateRows(c.name, rows));
    }
    if (issues.length) {
      return NextResponse.json({ error: "validation_failed", issues: issues.slice(0, 50) }, { status: 400 });
    }

    await connectDb();
    const u = await uid();
    // Stamp every incoming row with the current user so a backup can never be
    // imported into someone else's account (and an older, pre-multi-tenant
    // backup gets correctly claimed on restore).
    const own = (doc: Record<string, unknown>) => ({ ...doc, userId: u });
    const report: Record<string, { restored: number; cleared?: number; failed?: number; error?: string; rolledBack?: boolean }> = {};
    let anyError = false;

    for (const c of COLLECTIONS) {
      const rows = parsed.collections[c.name];
      if (!Array.isArray(rows)) continue; // collection absent from this backup

      if (parsed.mode === "replace") {
        // Snapshot only THIS user's contents so we can roll back on failure —
        // never touch other users' rows.
        const snapshot = await c.model.find({ userId: u }).lean();
        try {
          const del = await c.model.deleteMany({ userId: u });
          if (rows.length) await c.model.insertMany(rows.map(own), { ordered: false, timestamps: false });
          report[c.name] = { cleared: del.deletedCount ?? 0, restored: rows.length };
        } catch (e) {
          // Restore the snapshot so the collection is never left empty.
          let rolledBack = false;
          try {
            await c.model.deleteMany({ userId: u });
            if (snapshot.length) await c.model.insertMany(snapshot, { ordered: false, timestamps: false });
            rolledBack = true;
          } catch {
            /* nothing more we can do; report it */
          }
          report[c.name] = { restored: 0, error: String(e), rolledBack };
          anyError = true;
        }
      } else {
        // merge: upsert by _id, one row at a time, counting outcomes honestly.
        let restored = 0;
        let failed = 0;
        let firstError: string | undefined;
        for (const doc of rows) {
          try {
            const _id = (doc as Record<string, unknown>)._id;
            if (_id == null) {
              await c.model.insertMany([own(doc)], { timestamps: false });
            } else {
              // Scope the match by userId too, so a backup _id can never
              // overwrite another user's document.
              await c.model.replaceOne({ _id, userId: u }, own(doc), { upsert: true, timestamps: false });
            }
            restored++;
          } catch (e) {
            failed++;
            if (!firstError) firstError = String(e);
          }
        }
        report[c.name] = failed ? { restored, failed, error: firstError } : { restored };
        if (failed) anyError = true;
      }
    }

    return NextResponse.json({ ok: !anyError, mode: parsed.mode, report });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid", issues: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "failed", detail: String(err) }, { status: 500 });
  }
}
