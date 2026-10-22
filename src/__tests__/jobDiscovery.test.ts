import { describe, expect, it } from "vitest";
import { getJobDiscoveryHref, hasValidJobCoordinates, jobDistanceBounds, jobDistanceKm, readJobDiscoveryPreferences, selectJobDiscoveryPage, type JobDiscoveryCandidate } from "@/lib/jobs/discovery";
import { applyFilters, sortJobs } from "@/lib/jobs/sortFilter";

const preferences = { sortOption: "distance" as const, filterState: { categories: [], maxDistanceKm: 5 } };
const candidate = (id: string, distance_km: number | null, created_at = "2026-10-22T12:00:00Z"): JobDiscoveryCandidate => ({ id, distance_km, created_at, category: "garden", wage_hourly: 17, public_lat: null, public_lng: null });

describe("job discovery distance and pagination", () => {
    it("finds an older nearby job even when more than one newest page is farther away", () => {
        const jobs = Array.from({ length: 30 }, (_, index) => candidate(`new-far-${index}`, 30 + index));
        jobs.push(candidate("old-near", 1, "2026-01-01T12:00:00Z"));
        expect(selectJobDiscoveryPage(jobs, new Set(), preferences, 24)).toEqual({ ids: ["old-near"], hasMore: false });
    });

    it("keeps radius, category, exclusions and the exact boundary ahead of pagination", () => {
        const jobs = [candidate("applied", 0), { ...candidate("other-category", 1), category: "pets" }, candidate("at-boundary", 5), candidate("outside", 5.00001)];
        expect(selectJobDiscoveryPage(jobs, new Set(["applied"]), { ...preferences, filterState: { categories: ["garden"], maxDistanceKm: 5 } }, 1))
            .toEqual({ ids: ["at-boundary"], hasMore: false });
    });

    it("does not let invalid or unknown distances pass an active radius", () => {
        const jobs = [candidate("zero", 0), ...[null, Number.NaN, Infinity, -1].map((distance, index) => candidate(`unknown-${index}`, distance))];
        expect(applyFilters(jobs, preferences.filterState).map(job => job.id)).toEqual(["zero"]);
        expect(sortJobs(jobs, "distance")[0].id).toBe("zero");
        expect(applyFilters(jobs, { categories: [], maxDistanceKm: null })).toHaveLength(5);
    });

    it("reports more matches only after filtering and includes them in a cumulative next page", () => {
        const jobs = [candidate("near", 1), candidate("second", 2), candidate("far", 20)];
        expect(selectJobDiscoveryPage(jobs, new Set(), preferences, 1)).toEqual({ ids: ["near"], hasMore: true });
        expect(selectJobDiscoveryPage(jobs, new Set(), preferences, 2)).toEqual({ ids: ["near", "second"], hasMore: false });
    });

    it("calculates actual coordinate distances, accepts zero coordinates and rejects invalid origins", () => {
        expect(hasValidJobCoordinates({ lat: 0, lng: 0 })).toBe(true);
        expect(jobDistanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111.195, 2);
        expect(jobDistanceKm({ lat: 50.62, lng: 6.95 }, { lat: 50.62, lng: 6.95 })).toBe(0);
        for (const origin of [{ lat: null, lng: 6.95 }, { lat: NaN, lng: 0 }, { lat: 91, lng: 0 }]) expect(jobDistanceKm(origin, { lat: 0, lng: 0 })).toBeNull();
    });

    it("uses bounds only as a prefilter and checks diagonal corners against the real radius", () => {
        const point = { lat: 0, lng: 0 };
        const bounds = jobDistanceBounds(point, 5)!;
        expect(bounds.latitudeMax).toBeGreaterThan(.04);
        expect(bounds.longitude!.east).toBeGreaterThan(.04);
        const distance = jobDistanceKm(point, { lat: .04, lng: .04 });
        expect(distance).toBeGreaterThan(5);
        expect(selectJobDiscoveryPage([candidate("corner", distance)], new Set(), preferences, 24).ids).toEqual([]);
        expect(jobDistanceBounds({ lat: 0, lng: 179.99 }, 5)!.longitude).toBeNull();
    });

    it("roundtrips real filter choices and resets only the old page when filters change", () => {
        const href = getJobDiscoveryHref("https://example.test/app-home/jobs?jobsPage=4&keep=value#jobs", { sortOption: "newest", filterState: { categories: ["garden", "pets"], maxDistanceKm: 10 } });
        const url = new URL(href, "https://example.test");
        expect(url.searchParams.has("jobsPage")).toBe(false);
        expect(url.searchParams.get("keep")).toBe("value");
        expect(url.hash).toBe("#jobs");
        expect(readJobDiscoveryPreferences(Object.fromEntries(url.searchParams))).toEqual({ sortOption: "newest", filterState: { categories: ["garden", "pets"], maxDistanceKm: 10 } });
    });

    it("does not pretend radius filtering works without a home location", () => {
        expect(readJobDiscoveryPreferences({ distance: "5", sort: "distance" }, false)).toEqual({ sortOption: "newest", filterState: { categories: [], maxDistanceKm: null } });
        expect(readJobDiscoveryPreferences({ distance: "NaN", sort: "broken" }).filterState.maxDistanceKm).toBeNull();
    });
});
