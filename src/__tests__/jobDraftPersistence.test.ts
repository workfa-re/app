import { describe, expect, it, vi } from "vitest";
import { createJobDraftPersistence, hasMeaningfulJobDraft, type JobDraftData } from "@/hooks/use-job-persistence";

const key = "workfare_create_job_draft";
const empty: JobDraftData = {
    title: "", description: "", wage: "", category: "", paymentType: "hourly", jobKind: "one_time",
    recurrenceRule: "weekly", continuityPreferred: true, isDefaultLocation: true,
};
class MemoryStorage {
    values = new Map<string, string>();
    failWrites = false;
    failRemovals = false;
    writes = vi.fn((name: string, value: string) => {
        if (this.failWrites) throw new Error("Quota exceeded");
        this.values.set(name, value);
    });
    getItem(name: string) { return this.values.get(name) ?? null; }
    setItem(name: string, value: string) { this.writes(name, value); }
    removeItem(name: string) { if (this.failRemovals) throw new Error("Removal blocked"); this.values.delete(name); }
}

describe("job draft persistence", () => {
    it("does no browser IO merely by constructing the persistence owner", () => {
        const storage = vi.fn(() => new MemoryStorage());
        const owner = createJobDraftPersistence(storage);
        expect(owner.getSnapshot()).toEqual({ draft: null, hasRestoredDraft: false });
        expect(storage).not.toHaveBeenCalled();
    });

    it("restores an existing draft once without writing it back unchanged", () => {
        const storage = new MemoryStorage();
        storage.values.set(key, JSON.stringify({ ...empty, title: "Gartenhilfe" }));
        const owner = createJobDraftPersistence(() => storage);
        const loaded = owner.load();
        expect(loaded).toMatchObject({ draft: { title: "Gartenhilfe" }, hasRestoredDraft: true });
        expect(owner.load()).toBe(loaded);
        expect(owner.save({ title: "Gartenhilfe" })).toBe(loaded);
        expect(storage.writes).not.toHaveBeenCalled();
    });

    it("does not call a fresh automatic save a restored draft", () => {
        const storage = new MemoryStorage();
        const owner = createJobDraftPersistence(() => storage);
        owner.load();
        const saved = owner.save({ ...empty, title: "Rasen mähen" });
        expect(saved).toMatchObject({ draft: { title: "Rasen mähen" }, hasRestoredDraft: false });
        expect(createJobDraftPersistence(() => storage).load().hasRestoredDraft).toBe(true);
    });

    it("merges immediate partial changes and skips identical writes and state replacements", () => {
        const storage = new MemoryStorage();
        const owner = createJobDraftPersistence(() => storage);
        owner.save({ title: "Gartenhilfe" });
        const combined = owner.save({ description: "Die Beete vorbereiten." });
        expect(combined.draft).toMatchObject({ title: "Gartenhilfe", description: "Die Beete vorbereiten." });
        expect(owner.save({ title: "Gartenhilfe", description: "Die Beete vorbereiten." })).toBe(combined);
        expect(storage.writes).toHaveBeenCalledTimes(2);
        expect(JSON.parse(storage.getItem(key)!)).toMatchObject(combined.draft!);
    });

    it("catches quota failures, preserves the old stored draft and retries the same new content", () => {
        const storage = new MemoryStorage();
        storage.values.set(key, JSON.stringify({ ...empty, title: "Alter Titel" }));
        const onError = vi.fn();
        const owner = createJobDraftPersistence(() => storage, onError);
        owner.load(); storage.failWrites = true;
        expect(() => owner.save({ title: "Neuer Titel" })).not.toThrow();
        expect(owner.getSnapshot().draft?.title).toBe("Neuer Titel");
        expect(JSON.parse(storage.getItem(key)!).title).toBe("Alter Titel");
        expect(onError).toHaveBeenCalledTimes(1);
        storage.failWrites = false;
        owner.save({ title: "Neuer Titel" });
        expect(JSON.parse(storage.getItem(key)!).title).toBe("Neuer Titel");
        expect(storage.writes).toHaveBeenCalledTimes(2);
        owner.save({ title: "Neuer Titel" });
        expect(storage.writes).toHaveBeenCalledTimes(2);
    });

    it("flushes the latest description and choices synchronously before leaving for payment setup", () => {
        const storage = new MemoryStorage();
        const owner = createJobDraftPersistence(() => storage);
        owner.save({ ...empty, description: "Älterer automatisch gespeicherter Text" });
        const latest = { ...empty, title: "Gartenhilfe", description: "Diese gerade geschriebene Beschreibung darf nicht verloren gehen.", reach: "extended" as const };
        expect(owner.flush(latest)).toBe(true);
        const resumed = createJobDraftPersistence(() => storage).load();
        expect(resumed.draft).toEqual(latest);
        expect(resumed.hasRestoredDraft).toBe(true);
    });

    it("reports a failed flush so navigation can stay on the form until the current draft is saved", () => {
        const storage = new MemoryStorage();
        const owner = createJobDraftPersistence(() => storage, vi.fn());
        owner.save({ ...empty, description: "Gespeicherter Text" });
        storage.failWrites = true;
        const latest = { ...empty, description: "Noch nicht gesicherte neue Beschreibung" };
        expect(owner.flush(latest)).toBe(false);
        expect(JSON.parse(storage.getItem(key)!).description).toBe("Gespeicherter Text");
        expect(owner.getSnapshot().draft?.description).toBe(latest.description);
        storage.failWrites = false;
        expect(owner.flush(latest)).toBe(true);
        expect(JSON.parse(storage.getItem(key)!).description).toBe(latest.description);
    });

    it("catches browser storage getter failures for load, save and clear", () => {
        const onError = vi.fn();
        const owner = createJobDraftPersistence(() => { throw new Error("Storage is blocked"); }, onError);
        expect(() => owner.load()).not.toThrow();
        expect(() => owner.save({ title: "Entwurf im Arbeitsspeicher" })).not.toThrow();
        expect(() => owner.clear()).not.toThrow();
        expect(owner.getSnapshot().draft?.title).toBe("Entwurf im Arbeitsspeicher");
        expect(onError).toHaveBeenCalledTimes(3);
    });

    it.each(["{broken", "null", "[]", '"not an object"'])("does not delete an unreadable stored value: %s", value => {
        const storage = new MemoryStorage(); storage.values.set(key, value);
        const owner = createJobDraftPersistence(() => storage, vi.fn());
        expect(owner.load()).toEqual({ draft: null, hasRestoredDraft: false });
        expect(storage.getItem(key)).toBe(value);
        expect(storage.writes).not.toHaveBeenCalled();
    });

    it("clears the explicit draft and its restoration state without recreating it", () => {
        const storage = new MemoryStorage(); storage.values.set(key, JSON.stringify(empty));
        const owner = createJobDraftPersistence(() => storage);
        owner.load();
        expect(owner.clear()).toEqual({ draft: null, hasRestoredDraft: false });
        expect(storage.getItem(key)).toBeNull();
        expect(storage.writes).not.toHaveBeenCalled();
    });

    it("retires a server-confirmed draft so a delayed autosave cannot resurrect the published job", () => {
        const storage = new MemoryStorage();
        const saved = { ...empty, title: "Bereits veröffentlichter Job", description: "Gespeicherte Beschreibung" };
        const owner = createJobDraftPersistence(() => storage);
        owner.save(saved);
        expect(owner.complete()).toBe(true);
        owner.save(saved);
        expect(owner.flush(saved)).toBe(false);
        expect(storage.getItem(key)).toBeNull();
        expect(createJobDraftPersistence(() => storage).load()).toEqual({ draft: null, hasRestoredDraft: false });
        const nextForm = createJobDraftPersistence(() => storage);
        expect(nextForm.flush({ ...empty, title: "Ein neuer Job" })).toBe(true);
    });

    it("does not falsely report removal and keeps autosave retired while failed cleanup is retried", () => {
        const storage = new MemoryStorage();
        const owner = createJobDraftPersistence(() => storage, vi.fn());
        owner.save({ ...empty, title: "Serverbestätigter Job" });
        storage.failRemovals = true;
        expect(owner.complete()).toBe(false);
        expect(owner.flush({ ...empty, title: "Veralteter Timer" })).toBe(false);
        expect(JSON.parse(storage.getItem(key)!).title).toBe("Serverbestätigter Job");
        storage.failRemovals = false;
        expect(owner.complete()).toBe(true);
        expect(storage.getItem(key)).toBeNull();
    });

    it("still lets an explicitly discarded unsent draft be replaced with new work", () => {
        const storage = new MemoryStorage();
        const owner = createJobDraftPersistence(() => storage);
        owner.save({ ...empty, title: "Verworfen" });
        owner.clear();
        expect(owner.flush({ ...empty, title: "Weiterbearbeitet" })).toBe(true);
    });

    it("can persist intentionally cleared fields of an existing draft", () => {
        const storage = new MemoryStorage(); storage.values.set(key, JSON.stringify({ ...empty, title: "Vorheriger Titel" }));
        const owner = createJobDraftPersistence(() => storage); owner.load(); owner.save(empty);
        expect(JSON.parse(storage.getItem(key)!).title).toBe("");
        expect(owner.getSnapshot().hasRestoredDraft).toBe(true);
    });
});

describe("fresh job form draft policy", () => {
    it("ignores an untouched empty form with or without a default address", () => {
        expect(hasMeaningfulJobDraft(empty, true)).toBe(false);
        expect(hasMeaningfulJobDraft({ ...empty, isDefaultLocation: false }, false)).toBe(false);
        expect(hasMeaningfulJobDraft({ ...empty, title: " \n ", description: "\t" }, true)).toBe(false);
    });

    it.each([
        { title: "Gartenhilfe" }, { description: "Die Beete vorbereiten." }, { wage: "0" }, { category: "garden" },
        { paymentType: "fixed" }, { jobKind: "recurring" as const }, { recurrenceRule: "monthly" as const },
        { continuityPreferred: false }, { isDefaultLocation: false }, { location: { address: "QA Beispielweg" } }, { reach: "extended" as const },
    ])("preserves a deliberate input or option change: %j", change => {
        expect(hasMeaningfulJobDraft({ ...empty, ...change }, true)).toBe(true);
    });
});
