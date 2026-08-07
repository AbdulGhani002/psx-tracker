// Offline iSave statement runner — same pipeline the API route uses.
// Run: npx tsx scripts/parse-isave-file.ts <statement.pdf>

import { readFileSync } from "node:fs";
import { extractLines } from "../lib/pdf/pos-text";
import { parseIsaveStatement, ISAVE_CODE_TO_MUFAP } from "../lib/funds/isave-parse";

async function main() {
  const file = process.argv[2];
  if (!file) { console.error("usage: npx tsx scripts/parse-isave-file.ts <statement.pdf>"); process.exit(2); }

  const pages = await extractLines(new Uint8Array(readFileSync(file)));
  const st = parseIsaveStatement(pages);
  console.log(JSON.stringify(st, null, 2));
  for (const f of st.funds) {
    const mapped = ISAVE_CODE_TO_MUFAP[f.code] ?? "(unmapped!)";
    console.log(`${f.code} → ${mapped}: ${f.units} u × ${f.nav} = ${f.value} as on ${f.asOf}`);
  }
  if (st.problems.length > 0) { console.error("\nREFUSED — problems above."); process.exit(1); }
}
main();
