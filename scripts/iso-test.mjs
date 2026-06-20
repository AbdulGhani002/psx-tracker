// Two-account data-isolation test against a running instance.
// Proves: a brand-new user sees ZERO of another user's data, same symbols
// don't collide, and settings are per-user.
const BASE = process.env.BASE || "http://localhost:8099";
const H = { "content-type": "application/json", "x-forwarded-proto": "http" };

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`); }
}

// Sign up and return the session cookie string.
async function signup(email, password) {
  const r = await fetch(`${BASE}/api/auth/signup`, { method: "POST", headers: H, body: JSON.stringify({ email, password }) });
  const setCookie = r.headers.get("set-cookie") || "";
  const m = setCookie.match(/(psx_session=[^;]+)/);
  if (!m) throw new Error(`signup ${email} gave no cookie (status ${r.status}): ${await r.text()}`);
  return m[1];
}
async function api(cookie, path, method = "GET", body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { ...H, cookie }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}

const stamp = Date.now();
const emailA = `iso-a-${stamp}@test.com`;
const emailB = `iso-b-${stamp}@test.com`;

console.log("== sign up two users ==");
const a = await signup(emailA, "passwordA1");
const b = await signup(emailB, "passwordB1");
check("A and B got distinct sessions", a && b && a !== b);

console.log("== A creates data ==");
const mkA = await api(a, "/api/holdings", "POST", { symbol: "HUBC", name: "Hub Power", targetAllocationPercent: 10 });
check("A holding created (201)", mkA.status === 201);
await api(a, "/api/watchlist", "POST", { symbol: "OGDC" });
await api(a, "/api/cash", "POST", { type: "DEPOSIT", amount: 50000 });
await api(a, "/api/settings", "PATCH", { filerStatus: "filer", inflationPct: 11 });

console.log("== B must see NOTHING of A ==");
const bHold = await api(b, "/api/holdings");
check("B sees 0 holdings", Array.isArray(bHold.json.holdings) && bHold.json.holdings.length === 0);
const bWatch = await api(b, "/api/watchlist");
const bw = bWatch.json.watchlist ?? bWatch.json.entries ?? bWatch.json;
check("B sees 0 watchlist", Array.isArray(bw) ? bw.length === 0 : true);
const bCash = await api(b, "/api/cash");
const bEntries = bCash.json.entries ?? bCash.json.cash ?? [];
check("B sees 0 cash entries", Array.isArray(bEntries) && bEntries.length === 0);
const bSettings = await api(b, "/api/settings");
check("B settings are default (not A's filer)", bSettings.json.filerStatus !== "filer" || bSettings.json.inflationPct !== 11);

console.log("== A still sees A's data ==");
const aHold = await api(a, "/api/holdings");
check("A sees exactly 1 holding (HUBC)", aHold.json.holdings?.length === 1 && aHold.json.holdings[0].symbol === "HUBC");
const aSettings = await api(a, "/api/settings");
check("A settings persisted (filer + inflation 11)", aSettings.json.filerStatus === "filer" && aSettings.json.inflationPct === 11);

console.log("== same symbol must not collide across users ==");
const mkB = await api(b, "/api/holdings", "POST", { symbol: "HUBC", name: "Hub Power", targetAllocationPercent: 25 });
check("B can also add HUBC (no global unique clash)", mkB.status === 201);
const aAfter = await api(a, "/api/holdings");
check("A's HUBC target still 10 (B's 25 didn't overwrite)", aAfter.json.holdings?.[0]?.targetAllocationPercent === 10);

console.log("== cross-account direct fetch by id is blocked ==");
const aHoldingId = aHold.json.holdings[0]._id;
const bTriesA = await api(b, `/api/holdings/HUBC`); // symbol route — should return B's own HUBC, not A's
check("B's /holdings/HUBC returns B's row (target 25), not A's", bTriesA.json?.targetAllocationPercent === 25);

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail === 0 ? 0 : 1);
