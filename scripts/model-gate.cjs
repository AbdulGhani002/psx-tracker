// Whether a newly trained strategy model may replace the one the server runs:
// its walk-forward record (lib/macro/models.ts, years it never saw) no worse,
// allowing for the noise of a month more of data: ranking skill (IC) within
// 0.005 of the current one's, and the best fifth's lead over the worst within
// half a point. Exit 0 to send it, 1 to keep the current one.
//   node scripts/model-gate.cjs CURRENT.json NEW.json
const fs = require("fs");

const [curFile, newFile] = process.argv.slice(2);
const now = JSON.parse(fs.readFileSync(newFile, "utf8"));
if (!fs.existsSync(curFile)) {
  console.log("no current model here: sending the new one");
  process.exit(0);
}
const cur = JSON.parse(fs.readFileSync(curFile, "utf8"));
const a = cur.record, b = now.record;
const fmt = (r) => `IC ${r.ic.toFixed(3)} (t ${r.icT.toFixed(1)}), lead ${(r.spread * 100).toFixed(2)}%, ${r.months} months`;
console.log(`current: ${fmt(a)}\nnew:     ${fmt(b)}`);
const ok = b.ic >= a.ic - 0.005 && b.spread >= a.spread - 0.005 && Array.isArray(now.nets) && now.nets.length > 0;
console.log(ok ? "the new model is no worse: sending it" : "the new model is worse: keeping the current one");
process.exit(ok ? 0 : 1);
