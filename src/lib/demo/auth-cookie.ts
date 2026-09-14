/** The demo deployment must not overwrite a normal platform login. */
export const demoAuthCookieOptions = process.env.NEXT_PUBLIC_WORKFARE_DEMO_ENABLED === "true"
  ? { name: "wf-demo-auth", sameSite: "lax" as const, path: "/" }
  : undefined;
