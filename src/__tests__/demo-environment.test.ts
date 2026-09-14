import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { requireDemoEnvironment } from "@/lib/demo/environment";

const DEMO_REF = "abcdefghijklmnopqrst";
const PRODUCTION_REF = "fqaditikccbxivpxukxp";
const HOSTED_URL = `https://${DEMO_REF}.supabase.co`;
const hostedEnv = {
  WORKFARE_DEMO_ENABLED: "true",
  NEXT_PUBLIC_WORKFARE_DEMO_ENABLED: "true",
  WORKFARE_DEMO_PROJECT_REF: DEMO_REF,
  NEXT_PUBLIC_SUPABASE_URL: HOSTED_URL,
};
const localEnv = {
  WORKFARE_DEMO_ENABLED: "true",
  NEXT_PUBLIC_WORKFARE_DEMO_ENABLED: "true",
  WORKFARE_DEMO_MODE: "local",
  WORKFARE_DEMO_PROJECT_REF: "workfare-demo-local",
  WORKFARE_DEMO_LOCAL_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
};

describe("explicit demo deployment activation", () => {
  it.each([undefined, "", "false", "1", "TRUE", "true "])(
    "rejects disabled or ambiguous activation %s",
    (enabled) => {
      expect(() => requireDemoEnvironment({ ...hostedEnv, WORKFARE_DEMO_ENABLED: enabled }))
        .toThrow("WORKFARE_DEMO_ENABLED=true");
    },
  );

  it.each([undefined, "", " ", "demo", "https://example.test", `${DEMO_REF}.supabase.co`])(
    "requires an explicit hosted project reference: %s",
    (reference) => {
      expect(() => requireDemoEnvironment({ ...hostedEnv, WORKFARE_DEMO_PROJECT_REF: reference })).toThrow();
    },
  );

  it.each(["", "production", "LOCAL", "local "])("rejects an unknown mode %s", (mode) => {
    expect(() => requireDemoEnvironment({ ...hostedEnv, WORKFARE_DEMO_MODE: mode })).toThrow();
  });
});

describe("isolated hosted Supabase project", () => {
  it("accepts matching explicit demo configuration and returns only non-secret identity", () => {
    const result = requireDemoEnvironment({ ...hostedEnv, SUPABASE_URL: `${HOSTED_URL}/` });

    expect(result).toEqual({ enabled: true, mode: "hosted", projectRef: DEMO_REF, supabaseUrl: HOSTED_URL });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("allows the server URL to be omitted but never the public URL", () => {
    expect(requireDemoEnvironment(hostedEnv).supabaseUrl).toBe(HOSTED_URL);
    expect(() => requireDemoEnvironment({ ...hostedEnv, NEXT_PUBLIC_SUPABASE_URL: undefined, SUPABASE_URL: HOSTED_URL })).toThrow();
  });

  it.each(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"] as const)(
    "rejects a production project in %s regardless of the declared demo reference",
    (variable) => {
      expect(() => requireDemoEnvironment({ ...hostedEnv, [variable]: `https://${PRODUCTION_REF}.supabase.co` }))
        .toThrow("production Supabase project is forbidden");
    },
  );

  it.each([PRODUCTION_REF, PRODUCTION_REF.toUpperCase()])("rejects a production reference %s even with another URL", (reference) => {
    expect(() => requireDemoEnvironment({ ...hostedEnv, WORKFARE_DEMO_PROJECT_REF: reference }))
      .toThrow("production Supabase project is forbidden");
  });

  it.each([
    "https://zyxwvutsrqponmlkjihg.supabase.co",
    `http://${DEMO_REF}.supabase.co`,
    `${HOSTED_URL}:444`,
    `${HOSTED_URL}.evil.test`,
    "https://custom-demo.example.test",
    "http://127.0.0.1:54321",
  ])("rejects project, transport or host mismatches: %s", (url) => {
    for (const variable of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]) {
      expect(() => requireDemoEnvironment({ ...hostedEnv, [variable]: url })).toThrow();
    }
  });

  it.each([
    "",
    "not a URL",
    `${HOSTED_URL}/rest/v1`,
    `${HOSTED_URL}/..`,
    `${HOSTED_URL}?host=localhost`,
    `${HOSTED_URL}#demo`,
    `${HOSTED_URL}/?`,
    `${HOSTED_URL}/#`,
    `https://user:password@${DEMO_REF}.supabase.co`,
    ` ${HOSTED_URL}`,
    `${HOSTED_URL}\n`,
  ])("rejects noncanonical or decorated base URLs: %s", (url) => {
    expect(() => requireDemoEnvironment({ ...hostedEnv, NEXT_PUBLIC_SUPABASE_URL: url })).toThrow();
  });

  it("does not ignore an explicitly empty server override", () => {
    expect(() => requireDemoEnvironment({ ...hostedEnv, SUPABASE_URL: "" })).toThrow();
  });
});

describe("explicit local demo isolation", () => {
  it.each(["http://localhost:54321", "http://127.0.0.1:54321", "https://localhost:54321"])(
    "accepts only an explicitly declared matching loopback origin: %s",
    (url) => {
      expect(requireDemoEnvironment({ ...localEnv, WORKFARE_DEMO_LOCAL_URL: url, NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_URL: `${url}/` }))
        .toEqual({ enabled: true, mode: "local", projectRef: "workfare-demo-local", supabaseUrl: url });
    },
  );

  it("requires separate local opt-in, project ID and URL", () => {
    for (const variable of ["WORKFARE_DEMO_MODE", "WORKFARE_DEMO_PROJECT_REF", "WORKFARE_DEMO_LOCAL_URL"]) {
      expect(() => requireDemoEnvironment({ ...localEnv, [variable]: undefined })).toThrow();
    }
  });

  it("forbids the production project reference in local mode too", () => {
    expect(() => requireDemoEnvironment({ ...localEnv, WORKFARE_DEMO_PROJECT_REF: PRODUCTION_REF }))
      .toThrow("production Supabase project is forbidden");
  });

  it.each([
    "http://localhost:54322",
    "http://127.0.0.1:54322",
    "https://localhost:54321",
    HOSTED_URL,
  ])("rejects differing local public and server endpoints: %s", (url) => {
    for (const variable of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]) {
      expect(() => requireDemoEnvironment({ ...localEnv, [variable]: url })).toThrow();
    }
  });

  it.each([
    "http://localhost",
    "http://127.0.0.1",
    "http://localhost.evil.test:54321",
    "http://127.0.0.2:54321",
    "http://[::1]:54321",
    "http://2130706433:54321",
    "http://0x7f000001:54321",
    "http://localhost:54321?host=example.test",
    "http://example.test:54321?host=localhost",
    "http://user:password@localhost:54321",
    HOSTED_URL,
  ])("rejects loopback aliases, unconfigured hosts or decorated origins: %s", (url) => {
    expect(() => requireDemoEnvironment({ ...localEnv, WORKFARE_DEMO_LOCAL_URL: url, NEXT_PUBLIC_SUPABASE_URL: url })).toThrow();
  });
});

describe("server secrets stay outside demo environment results", () => {
  it("never reads secret key values, including legacy and current server keys", () => {
    const environment = { ...hostedEnv };
    for (const key of ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"]) {
      Object.defineProperty(environment, key, { get: () => { throw new Error("Secret values must not be accessed by the identity validator"); } });
    }
    expect(JSON.stringify(requireDemoEnvironment(environment))).toBe(JSON.stringify({ enabled: true, mode: "hosted", projectRef: DEMO_REF, supabaseUrl: HOSTED_URL }));
  });

  it("does not reflect malformed URL credentials or environment values in errors", () => {
    const marker = "private-test-value";
    let failure: unknown;
    try {
      requireDemoEnvironment({ ...hostedEnv, NEXT_PUBLIC_SUPABASE_URL: `https://user:${marker}@example.test` });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).not.toContain(marker);
    expect(JSON.stringify(failure)).not.toContain(marker);
  });
});

 it.each([undefined, "false", "TRUE"])("rejects mismatched client activation %s", (flag) => {
  expect(() => requireDemoEnvironment({ ...hostedEnv, NEXT_PUBLIC_WORKFARE_DEMO_ENABLED: flag })).toThrow("Server and public demo flags");
});
