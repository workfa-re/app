import "server-only";
import { requireDemoEnvironment } from "@/lib/demo/environment";
import { inspectPaymentsConfiguration, type PaymentsEnvironment } from "./config";
import type { PaymentMode } from "./types";

export class PaymentFlowError extends Error {
    constructor(readonly code: string, readonly status = 400) {
        super(`Workfare Pay: ${code}`);
        this.name = "PaymentFlowError";
    }
}

export type PaymentRuntime = Readonly<{ mode: PaymentMode; origin: string; platformAccountRef?: string }>;

function canonicalUrl(value: string | undefined): URL {
    let url: URL;
    try { url = new URL(value ?? ""); } catch { throw new PaymentFlowError("invalid_live_configuration", 503); }
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash
        || (value !== url.origin && value !== `${url.origin}/`)) throw new PaymentFlowError("invalid_live_configuration", 503);
    return url;
}

export function requirePaymentRuntime(environment: PaymentsEnvironment = process.env): PaymentRuntime {
    const mode = environment.WORKFARE_PAY_MODE;
    if (mode === "live") {
        if (inspectPaymentsConfiguration(environment).status !== "live") throw new PaymentFlowError("invalid_live_configuration", 503);
        if (environment.WORKFARE_DEMO_ENABLED === "true" || environment.NEXT_PUBLIC_WORKFARE_DEMO_ENABLED === "true"
            || environment.WORKFARE_DEMO_MODE || environment.WORKFARE_DEMO_PROJECT_REF || environment.WORKFARE_DEMO_LOCAL_URL) {
            throw new PaymentFlowError("live_demo_environment_forbidden", 503);
        }
        const origin = canonicalUrl(environment.APP_ORIGIN);
        const database = canonicalUrl(environment.SUPABASE_URL);
        const publicDatabase = canonicalUrl(environment.NEXT_PUBLIC_SUPABASE_URL);
        const project = environment.WORKFARE_PAY_LIVE_PROJECT_REF;
        const platform = environment.WORKFARE_PAY_LIVE_PLATFORM_ACCOUNT;
        if (!project || !/^[a-z0-9]{20}$/.test(project) || database.hostname !== `${project}.supabase.co` || database.origin !== publicDatabase.origin
            || !platform || !/^acct_[A-Za-z0-9]+$/.test(platform)
            || !origin.hostname.includes(".") || /(?:localhost|\.local|\.test|\.example|\.invalid)$/.test(origin.hostname)
            || /^[\d.]+$/.test(origin.hostname) || origin.hostname.includes(":")) throw new PaymentFlowError("invalid_live_configuration", 503);
        return Object.freeze({ mode: "live", origin: origin.origin, platformAccountRef: platform });
    }
    if (mode !== "sandbox" && mode !== "local_simulation") throw new PaymentFlowError("payments_disabled", 503);
    // All currently implemented modes are isolated development features. A test
    // key alone never grants permission to use the production database.
    const demo = requireDemoEnvironment(environment);
    if (demo.mode !== "local") throw new PaymentFlowError("local_environment_required", 503);
    let origin: URL;
    try { origin = new URL(environment.APP_ORIGIN ?? ""); } catch { throw new PaymentFlowError("invalid_app_origin", 503); }
    if (!["http:", "https:"].includes(origin.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
        || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash
        || (environment.APP_ORIGIN !== origin.origin && environment.APP_ORIGIN !== `${origin.origin}/`)) {
        throw new PaymentFlowError("invalid_app_origin", 503);
    }
    if (mode === "sandbox" && inspectPaymentsConfiguration(environment).status !== "sandbox") throw new PaymentFlowError("invalid_sandbox_configuration", 503);
    return Object.freeze({ mode, origin: origin.origin });
}

/** Next's standalone server may use its bind address as request.url's origin. */
export function assertPaymentRequestHost(request: Request, runtime: PaymentRuntime, environment: PaymentsEnvironment = process.env) {
    const canonical = new URL(runtime.origin);
    const target = new URL(request.url);
    const host = request.headers.get("host");
    const forwardedHost = request.headers.get("x-forwarded-host");
    const forwardedProtocol = request.headers.get("x-forwarded-proto");
    const forwardedPort = request.headers.get("x-forwarded-port");
    const protocol = canonical.protocol.slice(0, -1);
    const port = canonical.port || (protocol === "https" ? "443" : "80");
    const reject = () => { throw new PaymentFlowError("same_origin_required", 403); };
    if (target.username || target.password
        || (host !== null && host !== canonical.host)
        || (forwardedHost !== null && forwardedHost !== canonical.host)
        || (forwardedProtocol !== null && forwardedProtocol !== protocol)) reject();
    if (target.origin === canonical.origin) {
        if (forwardedPort !== null && forwardedPort !== port) reject();
        return;
    }
    const bindPort = environment.PORT ?? "3000";
    if (runtime.mode !== "live" || canonical.protocol !== "https:"
        || !["http:", "https:"].includes(target.protocol)
        || !["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "[::]"].includes(target.hostname)
        || !/^[1-9][0-9]{0,4}$/.test(bindPort) || Number(bindPort) > 65535 || target.port !== bindPort
        || host !== canonical.host || forwardedHost !== canonical.host || forwardedProtocol !== "https"
        // Next fills a missing forwarded port with its own bound server port.
        || (forwardedPort !== null && forwardedPort !== port && forwardedPort !== bindPort)) reject();
}

export function assertPaymentSameOrigin(request: Request, runtime: PaymentRuntime) {
    assertPaymentRequestHost(request, runtime);
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    if (origin !== runtime.origin
        || (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none")) {
        throw new PaymentFlowError("same_origin_required", 403);
    }
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new PaymentFlowError("json_required", 415);
}
