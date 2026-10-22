import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const imports = vi.hoisted(() => ({ detail: vi.fn(), application: vi.fn(), filter: vi.fn(), chat: vi.fn() }));
vi.mock("@/components/jobs/JobDetailModal", () => { imports.detail(); return { default: () => null }; });
vi.mock("@/components/jobs/JobApplicationModal", () => { imports.application(); return { default: () => null }; });
vi.mock("@/components/jobs/JobFilterSortPanel", () => { imports.filter(); return { default: () => null }; });
vi.mock("@/components/activity/ApplicationChat", () => { imports.chat(); return { default: () => null }; });

describe("speculative UI warmup", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { connection: { effectiveType: "4g", saveData: false } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shares the detail import across repeated job intents without loading unrelated UI", async () => {
    const { warmJobsUI } = await import("@/lib/ui-warmup");
    const first = warmJobsUI();
    expect(warmJobsUI()).toBe(first);
    await first;
    expect(imports.detail).toHaveBeenCalledTimes(1);
    expect(imports.application).not.toHaveBeenCalled();
    expect(imports.filter).not.toHaveBeenCalled();
    expect(imports.chat).not.toHaveBeenCalled();
  });

  it.each([{ saveData: true, effectiveType: "4g" }, { saveData: false, effectiveType: "2g" }, { saveData: false, effectiveType: "slow-2g" }])("skips optional downloads for %o", async (connection) => {
    vi.stubGlobal("navigator", { connection });
    const { warmJobsUI } = await import("@/lib/ui-warmup");
    await warmJobsUI();
    expect(Object.values(imports).every((load) => load.mock.calls.length === 0)).toBe(true);
  });

  it("never starts browser-only imports during server rendering", async () => {
    const { warmJobsUI } = await import("@/lib/ui-warmup");
    vi.stubGlobal("window", undefined);
    await warmJobsUI();
    expect(Object.values(imports).every((load) => load.mock.calls.length === 0)).toBe(true);
  });

  it("contains speculative chunk failures and permits another warmup attempt", async () => {
    vi.doMock("@/components/jobs/JobDetailModal", () => { throw new Error("Synthetic chunk failure"); });
    const { warmJobsUI } = await import("@/lib/ui-warmup");
    const first = warmJobsUI();
    await expect(first).resolves.toBeUndefined();
    vi.doMock("@/components/jobs/JobDetailModal", () => ({ default: () => null }));
    const retry = warmJobsUI();
    expect(retry).not.toBe(first);
    await expect(retry).resolves.toHaveProperty("default");
  });
});
