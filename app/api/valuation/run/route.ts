import { NextResponse } from "next/server";
import { uid } from "@/lib/auth/uid";
import { runValuations } from "@/lib/valuation/run";

export const dynamic = "force-dynamic";

// Value every approved share now, on the latest close.
export async function POST() {
  const userId = await uid();
  return NextResponse.json(await runValuations(userId));
}
