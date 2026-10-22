import { deriveVisibleJobs, isValidMaxDistanceKm, isValidSortOption, type FilterState, type SortOption } from "./sortFilter";

export type JobCoordinates = { lat?: number | null; lng?: number | null };
export type JobDiscoveryPreferences = { sortOption: SortOption; filterState: FilterState };
export type JobDiscoveryCandidate = {
    id: string; created_at: string; category: string | null; wage_hourly: number | null;
    public_lat: number | null; public_lng: number | null; distance_km: number | null;
};
type SearchParams = Record<string, string | string[] | undefined>;
const EARTH_KM = 6371;

export function hasValidJobCoordinates(point: JobCoordinates): point is { lat: number; lng: number } {
    return point.lat != null && point.lng != null && Number.isFinite(point.lat) && Number.isFinite(point.lng)
        && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
}

export function jobDistanceKm(origin: JobCoordinates, target: JobCoordinates): number | null {
    if (!hasValidJobCoordinates(origin) || !hasValidJobCoordinates(target)) return null;
    const radians = Math.PI / 180;
    const halfLat = (target.lat - origin.lat) * radians / 2;
    const halfLng = (target.lng - origin.lng) * radians / 2;
    const a = Math.sin(halfLat) ** 2 + Math.cos(origin.lat * radians) * Math.cos(target.lat * radians) * Math.sin(halfLng) ** 2;
    return EARTH_KM * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}

/** A bounding rectangle only narrows the query; the exact radius is checked afterwards. */
export function jobDistanceBounds(origin: JobCoordinates, radius: number | null) {
    if (!hasValidJobCoordinates(origin) || radius === null) return null;
    const latitudeDelta = radius / EARTH_KM * 180 / Math.PI;
    const latitudeMin = Math.max(-90, origin.lat - latitudeDelta);
    const latitudeMax = Math.min(90, origin.lat + latitudeDelta);
    const longitudeDelta = latitudeMin <= -90 || latitudeMax >= 90 ? 180
        : Math.asin(Math.min(1, Math.sin(radius / EARTH_KM) / Math.cos(origin.lat * Math.PI / 180))) * 180 / Math.PI;
    const west = origin.lng - longitudeDelta;
    const east = origin.lng + longitudeDelta;
    return { latitudeMin, latitudeMax, longitude: west >= -180 && east <= 180 ? { west, east } : null };
}

export function readJobDiscoveryPreferences(params: SearchParams, hasLocation = true): JobDiscoveryPreferences {
    const distance = typeof params.distance === "string" && params.distance.trim() ? Number(params.distance) : null;
    const categories = typeof params.categories === "string"
        ? [...new Set(params.categories.split(",").filter(category => /^[a-z_]{1,32}$/.test(category)))] : [];
    return {
        sortOption: isValidSortOption(params.sort) && (hasLocation || params.sort !== "distance") ? params.sort : hasLocation ? "distance" : "newest",
        filterState: { categories, maxDistanceKm: hasLocation && isValidMaxDistanceKm(distance) ? distance : null },
    };
}

export function hasJobDiscoveryQuery(params: SearchParams) {
    return ["sort", "distance", "categories"].some(key => params[key] !== undefined);
}

/** Filter and sort the full candidate set before applying the visible page size. */
export function selectJobDiscoveryPage(candidates: readonly JobDiscoveryCandidate[], excludedJobIds: ReadonlySet<string>, preferences: JobDiscoveryPreferences, visibleLimit: number) {
    const matching = deriveVisibleJobs(candidates.filter(job => !excludedJobIds.has(job.id)), preferences.filterState, preferences.sortOption);
    return { ids: matching.slice(0, visibleLimit).map(job => job.id), hasMore: matching.length > visibleLimit };
}

export function getJobDiscoveryHref(currentHref: string, preferences: JobDiscoveryPreferences) {
    const url = new URL(currentHref);
    url.searchParams.delete("jobsPage");
    url.searchParams.set("sort", preferences.sortOption);
    if (preferences.filterState.maxDistanceKm === null) url.searchParams.delete("distance");
    else url.searchParams.set("distance", String(preferences.filterState.maxDistanceKm));
    if (preferences.filterState.categories.length) url.searchParams.set("categories", preferences.filterState.categories.join(","));
    else url.searchParams.delete("categories");
    return `${url.pathname}${url.search}${url.hash}`;
}
