import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const service = vi.hoisted(() => ({ requireRecipientUser:vi.fn(), startRecipientSession: vi.fn(), finishLocalRecipientSession: vi.fn(), syncRecipientStatus: vi.fn(), handleRecipientWebhook: vi.fn() }));
vi.mock("@/lib/payments/recipient-service.server", () => service);
import { POST as session } from "@/app/api/payments/recipient/session/route";
import { POST as finish } from "@/app/api/payments/recipient/local/route";
import { POST as sync } from "@/app/api/payments/recipient/sync/route";
import { POST as webhook } from "@/app/api/payments/recipient/webhook/route";
const origin="http://localhost:3001";
const request=(body:unknown={},headers:Record<string,string>={})=>new Request(`${origin}/api/payments/recipient/session`,{method:"POST",headers:{origin,"content-type":"application/json","sec-fetch-site":"same-origin","x-workfare-owner":"11111111-1111-4111-8111-111111111111",...headers},body:typeof body==="string"?body:JSON.stringify(body)});
beforeEach(()=>{
    vi.resetAllMocks();
    for(const [key,value] of Object.entries({WORKFARE_PAY_MODE:"local_simulation",WORKFARE_DEMO_ENABLED:"true",NEXT_PUBLIC_WORKFARE_DEMO_ENABLED:"true",WORKFARE_DEMO_MODE:"local",WORKFARE_DEMO_PROJECT_REF:"local-recipient-tests",WORKFARE_DEMO_LOCAL_URL:"http://127.0.0.1:55321",NEXT_PUBLIC_SUPABASE_URL:"http://127.0.0.1:55321",APP_ORIGIN:origin}))vi.stubEnv(key,value);
    service.startRecipientSession.mockResolvedValue({kind:"local",sessionId:"owner-session",component:"onboarding"});
    service.finishLocalRecipientSession.mockResolvedValue({ok:true,snapshot:{status:"ready"}});
    service.syncRecipientStatus.mockResolvedValue({ok:true,snapshot:{status:"pending"}});
    service.handleRecipientWebhook.mockResolvedValue({received:true});
});
afterEach(()=>vi.unstubAllEnvs());
describe("recipient route boundaries",()=>{
    it.each([session,finish,sync])("checks origin before the authenticated service",async handler=>{
        expect((await handler(request({}, {origin:"https://other.example"}))).status).toBe(403);
        expect(service.startRecipientSession).not.toHaveBeenCalled();expect(service.finishLocalRecipientSession).not.toHaveBeenCalled();expect(service.syncRecipientStatus).not.toHaveBeenCalled();
    });
    it.each([{accountId:"acct_victim"},{userId:"victim"},{bankAccount:"never-accept-this"},{component:"onboarding",consent:true,accountRef:"acct_victim"}])("does not accept client-provided recipient identity %j",async body=>{
        expect((await session(request(body))).status).toBe(400);expect(service.startRecipientSession).not.toHaveBeenCalled();
    });
    it("does not cache owner-bound setup sessions and forwards only the scoped component",async()=>{
        const response=await session(request({component:"management",consent:true},{"idempotency-key":"operation"}));
        expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");
        expect(service.startRecipientSession).toHaveBeenCalledWith({component:"management",consent:true,operationId:"operation"});
    });
    it("does not accept simulation outcomes as real payout data",async()=>{
        expect((await finish(request({sessionId:"owner-session",outcome:"complete"}))).status).toBe(200);
        expect(service.finishLocalRecipientSession).toHaveBeenCalledWith("owner-session","complete");
        expect((await finish(request({sessionId:"owner-session",outcome:"approved"}))).status).toBe(400);
        expect((await finish(request({sessionId:"owner-session",outcome:"complete",payoutsEnabled:true}))).status).toBe(400);
    });
    it("rejects account IDs and a success flag in synchronization",async()=>{
        expect((await sync(request({accountRef:"acct_victim"}))).status).toBe(400);
        expect((await sync(request({success:true}))).status).toBe(400);
        expect((await sync(request())).status).toBe(200);expect(service.syncRecipientStatus).toHaveBeenCalledExactlyOnceWith();
    });
    it("forwards the untouched signed webhook body without browser-origin requirements",async()=>{
        const payload=' {"signed":"event"} ';
        const response=await webhook(new Request(`${origin}/api/payments/recipient/webhook`,{method:"POST",headers:{"stripe-signature":"signed-header"},body:payload}));
        expect(response.status).toBe(200);expect(service.handleRecipientWebhook).toHaveBeenCalledWith(payload,"signed-header");
    });
    it("bounds unsigned and oversized webhook input before service processing",async()=>{
        expect((await webhook(request({}))).status).toBe(400);
        expect((await webhook(request("x".repeat(262145),{"stripe-signature":"signature"}))).status).toBe(413);
        expect(service.handleRecipientWebhook).not.toHaveBeenCalled();
    });
    it("fails closed in disabled mode before any service call",async()=>{
        vi.stubEnv("WORKFARE_PAY_MODE","disabled");expect((await session(request({component:"onboarding",consent:true}))).status).toBe(503);
        expect(service.startRecipientSession).not.toHaveBeenCalled();
    });
});
