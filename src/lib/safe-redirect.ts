const INTERNAL_REDIRECT_ORIGIN = "https://workfare.internal";

/** Accept only same-origin, root-relative navigation targets from URL input. */
export function getSafeInternalRedirect(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const candidate = value.trim();
  if (
    candidate.length === 0
    || candidate.length > 2_048
    || !candidate.startsWith("/")
    || candidate.startsWith("//")
    || candidate.includes("\\")
    || /[\u0000-\u001F\u007F]/.test(candidate)
  ) {
    return null;
  }

  try {
    const parsed = new URL(candidate, INTERNAL_REDIRECT_ORIGIN);
    if (
      parsed.origin !== INTERNAL_REDIRECT_ORIGIN
      || parsed.username
      || parsed.password
      || !parsed.pathname.startsWith("/")
      || parsed.pathname.startsWith("//")
    ) {
      return null;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function safeInternalRedirectOr(value: unknown, fallback: string) {
  return getSafeInternalRedirect(value) ?? fallback;
}
