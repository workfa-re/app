export const DEMO_ROLES = ["seeker", "private-provider", "company"] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];
export const DEMO_IDENTITIES = [...DEMO_ROLES, "guardian", "peer-seeker"] as const;
export type DemoIdentity = (typeof DEMO_IDENTITIES)[number];
export function parseDemoRole(value: unknown): DemoRole | null {
  return typeof value === "string" && (DEMO_ROLES as readonly string[]).includes(value)
    ? value as DemoRole : null;
}
export function demoHomePath(role: DemoRole): string {
  return role === "seeker" ? "/app-home/jobs" : "/app-home/offers";
}
