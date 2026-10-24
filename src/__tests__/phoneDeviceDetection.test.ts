import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({
    cleanup: undefined as void | (() => void),
    updates: [] as boolean[],
}));

vi.mock("react", async () => {
    const actual = await vi.importActual<typeof import("react")>("react");

    return {
        ...actual,
        useEffect: (effect: () => void | (() => void)) => {
            hookState.cleanup = effect();
        },
        useState: () => [
            false,
            (value: boolean) => hookState.updates.push(value),
        ],
    };
});

import { usePhoneDevice } from "@/hooks/use-phone-device";

type DeviceEnvironment = {
    coarsePointer?: boolean;
    height: number;
    maxTouchPoints?: number;
    noHover?: boolean;
    platform?: string;
    screenHeight: number;
    screenWidth: number;
    userAgent: string;
    userAgentDataMobile?: boolean;
    width: number;
};

function installDeviceEnvironment(environment: DeviceEnvironment) {
    const windowListeners = new Map<string, EventListener>();
    const mediaListeners: Array<{ listener: EventListener; query: string }> = [];

    vi.stubGlobal("navigator", {
        maxTouchPoints: environment.maxTouchPoints ?? 0,
        platform: environment.platform ?? "",
        userAgent: environment.userAgent,
        userAgentData: environment.userAgentDataMobile === undefined
            ? undefined
            : { mobile: environment.userAgentDataMobile },
    });
    vi.stubGlobal("window", {
        addEventListener: (event: string, listener: EventListener) => {
            windowListeners.set(event, listener);
        },
        innerHeight: environment.height,
        innerWidth: environment.width,
        matchMedia: (query: string) => ({
            addEventListener: (_event: string, listener: EventListener) => {
                mediaListeners.push({ listener, query });
            },
            matches: query === "(pointer: coarse)"
                ? (environment.coarsePointer ?? false)
                : query === "(hover: none)"
                    ? (environment.noHover ?? false)
                    : false,
            media: query,
            removeEventListener: vi.fn(),
        }),
        removeEventListener: vi.fn(),
        screen: {
            height: environment.screenHeight,
            width: environment.screenWidth,
        },
    });

    return { mediaListeners, windowListeners };
}

function PhoneDeviceProbe() {
    usePhoneDevice();
    return hookState.updates.at(-1);
}

describe("phone device detection", () => {
    beforeEach(() => {
        hookState.cleanup = undefined;
        hookState.updates = [];
    });

    afterEach(() => {
        hookState.cleanup?.();
        vi.unstubAllGlobals();
    });

    it("recognizes a portrait iPhone even before pointer media queries settle", () => {
        installDeviceEnvironment({
            height: 844,
            platform: "iPhone",
            screenHeight: 844,
            screenWidth: 390,
            userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)",
            width: 390,
        });

        expect(PhoneDeviceProbe()).toBe(true);
    });

    it("recognizes a phone-sized coarse device in landscape", () => {
        installDeviceEnvironment({
            coarsePointer: true,
            height: 390,
            noHover: true,
            platform: "Linux armv8l",
            screenHeight: 844,
            screenWidth: 390,
            userAgent: "Mozilla/5.0",
            width: 844,
        });

        expect(PhoneDeviceProbe()).toBe(true);
    });

    it("keeps an iPad with a desktop user agent on the tablet navigation", () => {
        installDeviceEnvironment({
            coarsePointer: true,
            height: 768,
            maxTouchPoints: 5,
            noHover: true,
            platform: "MacIntel",
            screenHeight: 1024,
            screenWidth: 1366,
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
            width: 1024,
        });

        expect(PhoneDeviceProbe()).toBe(false);
    });

    it("does not classify a narrow desktop browser window as a phone", () => {
        installDeviceEnvironment({
            height: 844,
            platform: "MacIntel",
            screenHeight: 1080,
            screenWidth: 1920,
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
            width: 390,
        });

        expect(PhoneDeviceProbe()).toBe(false);
    });
});
