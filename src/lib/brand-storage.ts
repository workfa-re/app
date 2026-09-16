/** Preserve existing browser drafts and resend cooldowns during the rename. */
const legacyPrefixes = [
  ["workfare_create_job_draft", "jobbridge_create_job_draft"],
  ["workfare-onboarding-draft:v1", "jobbridge-onboarding-draft:v1"],
  ["workfare-confirmation-email-last-sent:", "jobbridge-confirmation-email-last-sent:"],
] as const;

type BrandStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function legacyKey(key: string): string | null {
  for (const [current, previous] of legacyPrefixes) {
    if (key === current || (current.endsWith(":") && key.startsWith(current))) {
      return previous + key.slice(current.length);
    }
  }
  return null;
}

export function readBrandStorage(storage: BrandStorage, key: string): string | null {
  try {
    const current = storage.getItem(key);
    if (current !== null) return current;
    const previousKey = legacyKey(key);
    if (!previousKey) return null;
    const previous = storage.getItem(previousKey);
    if (previous === null) return null;
    // If the new write is blocked, the original value remains recoverable.
    try {
      storage.setItem(key, previous);
      storage.removeItem(previousKey);
    } catch {}
    return previous;
  } catch {
    return null;
  }
}

export function writeBrandStorage(storage: BrandStorage, key: string, value: string): void {
  storage.setItem(key, value);
  const previousKey = legacyKey(key);
  if (previousKey) {
    try { storage.removeItem(previousKey); } catch {}
  }
}

export function removeBrandStorage(storage: BrandStorage, key: string): void {
  // Clear both keys so a removed draft cannot reappear through the migration.
  for (const candidate of [key, legacyKey(key)]) {
    if (candidate) {
      try { storage.removeItem(candidate); } catch {}
    }
  }
}
