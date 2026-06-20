import { scryptSync, randomBytes, timingSafeEqual } from "crypto";

// Password hashing with scrypt (built into Node — no native bcrypt dependency,
// which keeps the standalone build portable). Stored as "salt:hash" hex.
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = (stored || "").split(":");
  if (!salt || !hash) return false;
  try {
    const computed = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return computed.length === expected.length && timingSafeEqual(computed, expected);
  } catch {
    return false;
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}
