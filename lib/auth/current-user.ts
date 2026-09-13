import "server-only";
import { cookies } from "next/headers";
import { AsyncLocalStorage } from "async_hooks";
import { verifySession, SESSION_COOKIE } from "./session";

// A job-scoped user override. Background jobs (the cron) have no request cookie,
// so they wrap per-user work in runAsUser(uid, ...) and every data query inside
// transparently scopes to that user — no need to thread userId through.
const userStore = new AsyncLocalStorage<string>();

export function runAsUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return userStore.run(userId, fn);
}

// The logged-in user's id for the current request/job. Returns null when not
// authenticated. Used to scope every data query so users only see their own data.
export async function getCurrentUserId(): Promise<string | null> {
  const override = userStore.getStore();
  if (override) return override;
  // A development machine looking at a copy of the data acts as one user
  // without a session. Ignored in production builds.
  if (process.env.NODE_ENV !== "production" && process.env.DEV_PREVIEW_USER) return process.env.DEV_PREVIEW_USER;
  try {
    const token = cookies().get(SESSION_COOKIE)?.value;
    const session = await verifySession(token);
    return session?.userId ?? null;
  } catch {
    // cookies() throws outside a request scope.
    return null;
  }
}

export async function resolveUserId(explicit?: string | null): Promise<string | null> {
  if (explicit) return explicit;
  return getCurrentUserId();
}
