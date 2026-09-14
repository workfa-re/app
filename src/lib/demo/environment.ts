import "server-only";

type EnvironmentValues = Readonly<Record<string, string | undefined>>;

export type DemoEnvironment = Readonly<{
  enabled: true;
  mode: "hosted" | "local";
  projectRef: string;
  supabaseUrl: string;
}>;

const PRODUCTION_PROJECT_REF = "fqaditikccbxivpxukxp";

function configurationError(message: string): never {
  // Never include environment values: a malformed URL may contain credentials.
  throw new Error(`Invalid Workfare demo environment: ${message}`);
}

function readBaseUrl(value: string | undefined, variable: string): URL {
  if (!value) configurationError(`${variable} is required.`);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    configurationError(`${variable} must be an absolute Supabase base URL.`);
  }

  if (
    !["http:", "https:"].includes(url.protocol)
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname !== "/"
    || (value !== url.origin && value !== `${url.origin}/`)
  ) {
    configurationError(`${variable} must be a canonical base URL without credentials, path, query or fragment.`);
  }

  if (url.hostname.split(".").includes(PRODUCTION_PROJECT_REF)) {
    configurationError("The production Supabase project is forbidden.");
  }

  return url;
}

/**
 * Validate server deployment configuration before constructing any demo client.
 * This makes no network calls and does not verify a remote database's contents.
 * Only non-secret identity values are returned; keys are never read or forwarded.
 */
export function requireDemoEnvironment(env: EnvironmentValues = process.env): DemoEnvironment {
  if (env.WORKFARE_DEMO_ENABLED !== "true") {
    configurationError("Demo access requires WORKFARE_DEMO_ENABLED=true.");
  }

  if (env.NEXT_PUBLIC_WORKFARE_DEMO_ENABLED !== "true") {
    configurationError("Server and public demo flags must both be enabled.");
  }

  const projectRef = env.WORKFARE_DEMO_PROJECT_REF;
  if (!projectRef) configurationError("WORKFARE_DEMO_PROJECT_REF is required.");
  if (projectRef.toLowerCase() === PRODUCTION_PROJECT_REF) {
    configurationError("The production Supabase project is forbidden.");
  }

  const mode = env.WORKFARE_DEMO_MODE ?? "hosted";
  if (mode !== "hosted" && mode !== "local") {
    configurationError("WORKFARE_DEMO_MODE must be hosted or local.");
  }

  const referencePattern = mode === "hosted" ? /^[a-z0-9]{20}$/ : /^[a-z0-9][a-z0-9_-]{0,62}$/;
  if (!referencePattern.test(projectRef)) {
    configurationError("WORKFARE_DEMO_PROJECT_REF must identify the configured demo project.");
  }

  const publicUrl = readBaseUrl(env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
  const serverUrl = env.SUPABASE_URL === undefined
    ? publicUrl
    : readBaseUrl(env.SUPABASE_URL, "SUPABASE_URL");

  if (mode === "hosted") {
    const expectedOrigin = `https://${projectRef}.supabase.co`;
    if (publicUrl.origin !== expectedOrigin || serverUrl.origin !== expectedOrigin) {
      configurationError("Public and server Supabase URLs must match the declared hosted demo project.");
    }
  } else {
    const localUrl = readBaseUrl(env.WORKFARE_DEMO_LOCAL_URL, "WORKFARE_DEMO_LOCAL_URL");
    if (
      !["localhost", "127.0.0.1"].includes(localUrl.hostname)
      || !localUrl.port
      || publicUrl.origin !== localUrl.origin
      || serverUrl.origin !== localUrl.origin
    ) {
      configurationError("Local demo URLs must match the explicitly configured localhost or 127.0.0.1 origin and port.");
    }
  }

  return Object.freeze({ enabled: true, mode, projectRef, supabaseUrl: publicUrl.origin });
}
