let jobsWarmPromise: Promise<unknown> | null = null;

function canWarmUI() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  return !connection?.saveData && !["slow-2g", "2g"].includes(connection?.effectiveType ?? "");
}

export function warmJobsUI() {
  if (!canWarmUI()) return Promise.resolve();
  if (!jobsWarmPromise) {
    jobsWarmPromise = import("@/components/jobs/JobDetailModal").catch(() => {
      // Speculative loading must not break navigation; allow a later intent to retry.
      jobsWarmPromise = null;
    });
  }

  return jobsWarmPromise;
}
