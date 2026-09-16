import { describe, expect, it } from "vitest";
import { readBrandStorage, removeBrandStorage, writeBrandStorage } from "@/lib/brand-storage";
import { currentBrandLabel, currentContactEmail } from "@/lib/brand-compat";

class MemoryStorage {
  values = new Map<string, string>();
  failWrites = false;

  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("Quota exceeded");
    this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
}

describe("brand storage transition", () => {
  it.each([
    ["jobbridge_create_job_draft", "workfare_create_job_draft", '{"title":"Gartenhilfe"}'],
    ["jobbridge-onboarding-draft:v1", "workfare-onboarding-draft:v1", '{"version":1,"step":"location"}'],
    ["jobbridge-confirmation-email-last-sent:person@example.test", "workfare-confirmation-email-last-sent:person@example.test", "1789551000000"],
  ])("preserves %s under the current name", (previous, current, value) => {
    const storage = new MemoryStorage();
    storage.setItem(previous, value);
    expect(readBrandStorage(storage, current)).toBe(value);
    expect(storage.getItem(current)).toBe(value);
    expect(storage.getItem(previous)).toBeNull();
  });

  it("keeps a newer draft when both versions exist", () => {
    const storage = new MemoryStorage();
    storage.setItem("jobbridge_create_job_draft", "old draft");
    storage.setItem("workfare_create_job_draft", "new draft");
    expect(readBrandStorage(storage, "workfare_create_job_draft")).toBe("new draft");
  });

  it("can still read the old draft when the browser cannot save its replacement", () => {
    const storage = new MemoryStorage();
    storage.setItem("jobbridge_create_job_draft", "recoverable draft");
    storage.failWrites = true;
    expect(readBrandStorage(storage, "workfare_create_job_draft")).toBe("recoverable draft");
    expect(storage.getItem("jobbridge_create_job_draft")).toBe("recoverable draft");
  });

  it("removes both versions so clearing a draft cannot resurrect it", () => {
    const storage = new MemoryStorage();
    storage.setItem("jobbridge_create_job_draft", "old draft");
    storage.setItem("workfare_create_job_draft", "new draft");
    removeBrandStorage(storage, "workfare_create_job_draft");
    expect(readBrandStorage(storage, "workfare_create_job_draft")).toBeNull();
    expect(storage.values.size).toBe(0);
  });

  it("does not mix cooldowns between different email addresses", () => {
    const storage = new MemoryStorage();
    storage.setItem("jobbridge-confirmation-email-last-sent:a@example.test", "123");
    expect(readBrandStorage(storage, "workfare-confirmation-email-last-sent:b@example.test")).toBeNull();
    expect(readBrandStorage(storage, "workfare-confirmation-email-last-sent:a@example.test")).toBe("123");
  });

  it("only removes the older value after saving a new one successfully", () => {
    const storage = new MemoryStorage();
    storage.setItem("jobbridge_create_job_draft", "old draft");
    storage.failWrites = true;
    expect(() => writeBrandStorage(storage, "workfare_create_job_draft", "new draft")).toThrow();
    expect(storage.getItem("jobbridge_create_job_draft")).toBe("old draft");
    storage.failWrites = false;
    writeBrandStorage(storage, "workfare_create_job_draft", "new draft");
    expect(storage.getItem("workfare_create_job_draft")).toBe("new draft");
    expect(storage.getItem("jobbridge_create_job_draft")).toBeNull();
  });

  it("does not migrate unrelated browser storage", () => {
    const storage = new MemoryStorage();
    storage.setItem("jobbridge_create_job_draft_extra", "unrelated");
    expect(readBrandStorage(storage, "workfare_create_job_draft_extra")).toBeNull();
    expect(storage.getItem("jobbridge_create_job_draft_extra")).toBe("unrelated");
  });
});

describe("stored branding compatibility", () => {
  it.each([
    [null, "Workfare"],
    [undefined, "Workfare"],
    ["   ", "Workfare"],
    ["JobBridge", "Workfare"],
    ["JobBridge Rheinbach", "Workfare Rheinbach"],
    ["JOB-BRIDGE Bonn", "Workfare Bonn"],
    ["Workfare", "Workfare"],
    ["Rheinbach", "Rheinbach"],
  ])("normalizes %s without losing the regional name", (value, expected) => {
    expect(currentBrandLabel(value)).toBe(expected);
  });

  it.each([
    [undefined, "kontakt@workfare.team"],
    ["kontakt@jobbridge.team", "kontakt@workfare.team"],
    [" SUPPORT@JOBBRIDGE.APP ", "SUPPORT@workfare.team"],
    ["support@workfare.team", "support@workfare.team"],
    ["contact@example.test", "contact@example.test"],
  ])("uses current contact branding for %s", (value, expected) => {
    expect(currentContactEmail(value)).toBe(expected);
  });
});
