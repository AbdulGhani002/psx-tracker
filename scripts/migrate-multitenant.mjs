// One-time migration: single-user -> multi-tenant.
//
// 1. Creates (or reuses) the owner User account from AUTH_USERNAME/AUTH_PASSWORD,
//    hashing the password with the SAME scrypt scheme the app uses so the owner
//    can log in with their existing credentials.
// 2. Stamps every pre-existing user-owned document (which has no userId, or an
//    empty one) with that owner's id, so all current data stays visible to them
//    and ONLY them.
//
// Safe to run against the live v2 DB BEFORE switching to the multi-tenant build:
// the old code ignores the new userId field, so adding it changes nothing for it.
// Idempotent: re-running only touches still-unstamped docs.
//
//   MONGODB_URI=... AUTH_USERNAME=... AUTH_PASSWORD=... \
//     OWNER_EMAIL=itsaghani@gmail.com node scripts/migrate-multitenant.mjs
//
import mongoose from "mongoose";
import { scryptSync, randomBytes } from "node:crypto";

// Mirror lib/auth/password.ts exactly (salt:hash, scrypt, 64-byte key).
function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

// Collections that are GLOBAL (shared market / system data) — never stamped.
const GLOBAL = new Set([
  "pricesnapshots",
  "fundamentals",
  "sbprates",
  "alertlogs",
  "feedsnapshots",
  "users",
]);

const UNSTAMPED = { $or: [{ userId: { $exists: false } }, { userId: "" }, { userId: null } ] };

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required");
  const email = (process.env.OWNER_EMAIL || process.env.AUTH_USERNAME || "").toLowerCase().trim();
  const password = process.env.AUTH_PASSWORD || "";
  if (!email) throw new Error("OWNER_EMAIL (or AUTH_USERNAME) is required");
  if (!password) throw new Error("AUTH_PASSWORD is required to set the owner's login password");

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  console.log(`connected to ${db.databaseName}`);

  // 1. Owner account ------------------------------------------------------
  const users = db.collection("users");
  let owner = await users.findOne({ email });
  if (owner) {
    console.log(`owner already exists: ${email} (${owner._id})`);
  } else {
    const now = new Date();
    const doc = {
      email,
      passwordHash: hashPassword(password),
      name: "Abdul Ghani",
      emailVerified: true,
      verifyToken: "",
      verifyTokenExp: null,
      resetToken: "",
      resetTokenExp: null,
      plan: "wealth",
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const res = await users.insertOne(doc);
    owner = { _id: res.insertedId, ...doc };
    console.log(`created owner ${email} -> ${owner._id}`);
  }
  const ownerId = String(owner._id);

  // 2. Stamp every user-owned collection ---------------------------------
  const all = await db.listCollections().toArray();
  const report = {};
  for (const { name } of all) {
    if (GLOBAL.has(name)) continue;
    const col = db.collection(name);
    // AppSettings is a per-user singleton keyed by `key` — set both fields so
    // the app's findOneAndUpdate({ userId }) picks up the existing settings.
    const set = name === "appsettings" ? { userId: ownerId, key: ownerId } : { userId: ownerId };
    const r = await col.updateMany(UNSTAMPED, { $set: set });
    if (r.matchedCount > 0) report[name] = r.modifiedCount;
  }

  console.log("stamped:", JSON.stringify(report, null, 2));
  console.log("done.");
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
