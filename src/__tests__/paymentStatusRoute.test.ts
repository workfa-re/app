import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const service=vi.hoisted(()=>({requirePaymentProvider:vi.fn(),getPaymentSettingsSnapshot:vi.fn()}));
vi.mock("@/lib/payments/service.server",()=>({requirePaymentProvider:service.requirePaymentProvider}));
vi.mock("@/lib/payments/repository.server",()=>({getPaymentSettingsSnapshot:service.getPaymentSettingsSnapshot}));
import { GET } from "@/app/api/payments/status/route";
import { PaymentFlowError } from "@/lib/payments/runtime.server";
const origin="http://localhost:3001";
const request=(query="",headers:Record<string,string>={})=>new Request(`${origin}/api/payments/status${query}`,{headers:{"x-workfare-owner":"11111111-1111-4111-8111-111111111111",...headers}});
beforeEach(()=>{
    vi.resetAllMocks();
    for(const [key,value] of Object.entries({WORKFARE_PAY_MODE:"local_simulation",WORKFARE_DEMO_ENABLED:"true",NEXT_PUBLIC_WORKFARE_DEMO_ENABLED:"true",WORKFARE_DEMO_MODE:"local",WORKFARE_DEMO_PROJECT_REF:"local-status-tests",WORKFARE_DEMO_LOCAL_URL:"http://127.0.0.1:55321",NEXT_PUBLIC_SUPABASE_URL:"http://127.0.0.1:55321",APP_ORIGIN:origin}))vi.stubEnv(key,value);
    service.requirePaymentProvider.mockResolvedValue("verified-provider");
    service.getPaymentSettingsSnapshot.mockResolvedValue({kind:"local",buyerReady:false,method:null});
});
afterEach(()=>vi.unstubAllEnvs());
describe("private payment status GET",()=>{
    it.each<Record<string,string>>([{}, {origin,"sec-fetch-site":"same-origin"},{"sec-fetch-site":"none"}])("returns a noncached owner snapshot for allowed browser requests %j",async headers=>{
        const response=await GET(request("",headers));expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");
        expect(service.requirePaymentProvider).toHaveBeenCalledExactlyOnceWith("11111111-1111-4111-8111-111111111111");expect(service.getPaymentSettingsSnapshot).toHaveBeenCalledExactlyOnceWith("verified-provider");
        expect(await response.json()).toEqual({kind:"local",buyerReady:false,method:null});
    });
    it.each<Record<string,string>>([{origin:"https://other.example"},{origin:"null"},{"sec-fetch-site":"cross-site"},{"sec-fetch-site":"same-site"}])("rejects cross-origin financial reads before identity or data access %j",async headers=>{
        const response=await GET(request("",headers));expect(response.status).toBe(403);expect(response.headers.get("cache-control")).toBe("no-store");
        expect(service.requirePaymentProvider).not.toHaveBeenCalled();expect(service.getPaymentSettingsSnapshot).not.toHaveBeenCalled();
    });
    it("rejects an alternate host even if its Origin header claims the configured origin",async()=>{
        const response=await GET(new Request("http://127.0.0.1:3001/api/payments/status",{headers:{origin}}));
        expect(response.status).toBe(403);expect(service.requirePaymentProvider).not.toHaveBeenCalled();
    });
    it.each(["?userId=other","?customerId=cus_other","?ready=true","?","?refresh=1&refresh=2"].filter(query=>query!=="?"))("does not accept target IDs or other query input %s",async query=>{
        expect((await GET(request(query))).status).toBe(400);expect(service.requirePaymentProvider).not.toHaveBeenCalled();
    });
    it.each([["authentication_required",401],["provider_account_required",403]] as const)("preserves %s without reading a snapshot",async(code,status)=>{
        service.requirePaymentProvider.mockRejectedValue(new PaymentFlowError(code,status));
        expect((await GET(request())).status).toBe(status);expect(service.getPaymentSettingsSnapshot).not.toHaveBeenCalled();
    });
    it("keeps disabled or hosted environments closed before accessing Auth",async()=>{
        vi.stubEnv("WORKFARE_PAY_MODE","disabled");expect((await GET(request())).status).toBe(503);
        vi.stubEnv("WORKFARE_PAY_MODE","local_simulation");vi.stubEnv("WORKFARE_DEMO_MODE","hosted");expect((await GET(request())).status).toBe(503);
        expect(service.requirePaymentProvider).not.toHaveBeenCalled();
    });
    it("never serializes underlying provider, email or credential diagnostics",async()=>{
        service.getPaymentSettingsSnapshot.mockRejectedValue(new Error("cus_private recipient@example.test sk_test_private"));
        const response=await GET(request());expect(response.status).toBe(503);const body=await response.text();
        for(const privateValue of ["cus_private","recipient@example.test","sk_test_private"])expect(body).not.toContain(privateValue);
        expect(response.headers.get("cache-control")).toBe("no-store");
    });
});
