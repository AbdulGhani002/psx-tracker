import { getCurrentUserId } from "./current-user";

// The current user's id, or a sentinel that matches no document. Used inline in
// API-route queries (reads, writes, recompute helpers) so every operation is
// scoped to the logged-in user. Middleware already blocks unauthenticated calls,
// so the sentinel is just a belt-and-braces guard against orphaning/leaking.
export async function uid(): Promise<string> {
  return (await getCurrentUserId()) ?? "__no_user__";
}
