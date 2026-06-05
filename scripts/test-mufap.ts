import fs from "fs";
import path from "path";
import { parseMufap } from "../lib/funds/mufap";

const html = fs.readFileSync(path.join(process.cwd(), "scripts/mufap-sample.html"), "utf8");
const funds = parseMufap(html);

console.log(`Parsed ${funds.length} funds.\n`);

const mcb = funds.filter((f) => /mcb|alhamra/i.test(f.name) || /mcb/i.test(f.amc));
console.log(`MCB / Alhamra funds (${mcb.length}):`);
for (const f of mcb.slice(0, 20)) {
  console.log(`  ${f.nav.toFixed(4).padStart(12)}  ${f.name}  [${f.amc}]`);
}

console.log("\nSanity: first 5 of all funds:");
for (const f of funds.slice(0, 5)) console.log(`  ${f.nav.toFixed(4).padStart(12)}  ${f.name}`);

const bad = funds.filter((f) => !Number.isFinite(f.nav) || f.nav <= 0);
console.log(`\nInvalid NAVs: ${bad.length}`);
