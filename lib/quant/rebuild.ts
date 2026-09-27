// Rebuilding the analysis on demand takes a minute or two (ninety names'
// bars, the model, thirteen charts), longer than the proxy in front of the
// server allows a request to run. So the button starts a job and the page
// asks after it: one job per user at a time, kept in this process, with the
// last error held for a while so a failed rebuild can say why. It is the
// evening job run by hand (daily.ts): the day's end-of-day file first, if the
// timer has not fetched it yet, then the reading, then the swing book.

import "server-only";
import { refreshCloses, rebuildUser } from "./daily";

type Job = { startedAt: string; done: boolean; finishedAt?: string; error?: string; charts?: number };

const jobs = new Map<string, Job>();
const KEEP_MS = 10 * 60 * 1000;

export function startRebuild(userId: string): { started: boolean; job: Job } {
  const current = jobs.get(userId);
  if (current && !current.done) return { started: false, job: current };
  const job: Job = { startedAt: new Date().toISOString(), done: false };
  jobs.set(userId, job);
  refreshCloses()
    .catch(() => null)
    .then(() => rebuildUser(userId))
    .then((r) => {
      job.charts = r.charts;
    })
    .catch((e) => {
      job.error = String(e instanceof Error ? e.message : e).slice(0, 300);
    })
    .finally(() => {
      job.done = true;
      job.finishedAt = new Date().toISOString();
      setTimeout(() => {
        if (jobs.get(userId) === job) jobs.delete(userId);
      }, KEEP_MS).unref?.();
    });
  return { started: true, job };
}

export function rebuildStatus(userId: string): Job | null {
  return jobs.get(userId) ?? null;
}
