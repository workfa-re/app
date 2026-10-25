import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const api = vi.hoisted(() => ({ client: vi.fn(), user: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabaseServer", () => ({ supabaseServer: api.client }));
import { getPaymentOrderForMessage } from "@/app/app-home/applications/actions";
import { getPaymentSystemMessageKind } from "@/lib/activity/payment-messages";
const applicationId="11111111-1111-4111-8111-111111111111", messageId="22222222-2222-4222-8222-222222222222", appointmentId="33333333-3333-4333-8333-333333333333",orderId="44444444-4444-4444-8444-444444444444";
beforeEach(()=>{vi.resetAllMocks();api.client.mockResolvedValue({auth:{getUser:api.user},rpc:api.rpc});api.user.mockResolvedValue({data:{user:{id:"current-user"}},error:null});api.rpc.mockResolvedValue({data:{applicationId,appointmentId,orderId,event:"payment_price_proposed"},error:null});});
describe("persisted price notice targets",()=>{
 it("resolves the exact participant-owned appointment from a server notice",async()=>{expect(await getPaymentOrderForMessage(applicationId,messageId)).toEqual({available:true,appointmentId,orderId});expect(api.rpc).toHaveBeenCalledExactlyOnceWith("get_application_payment_for_message",{p_application_id:applicationId,p_message_id:messageId});});
 it.each(["application","message"])("rejects malformed %s identifiers before database access",async source=>{expect(await getPaymentOrderForMessage(source==="application"?"wrong":applicationId,source==="message"?"wrong":messageId)).toMatchObject({available:false});expect(api.client).not.toHaveBeenCalled();});
 it("requires the current verified authentication response",async()=>{api.user.mockResolvedValue({data:{user:null},error:null});expect(await getPaymentOrderForMessage(applicationId,messageId)).toMatchObject({available:false});expect(api.rpc).not.toHaveBeenCalled();});
 it.each([null,{applicationId:"other",appointmentId,orderId,event:"payment_price_proposed"},{applicationId,appointmentId:"wrong",orderId,event:"payment_price_proposed"},{applicationId,appointmentId,orderId:"wrong",event:"payment_price_proposed"},{applicationId,appointmentId,orderId,event:"unrelated"}])("does not guess a target from an invalid lookup: %j",async data=>{api.rpc.mockResolvedValue({data,error:null});expect(await getPaymentOrderForMessage(applicationId,messageId)).toMatchObject({available:false});});
 it("keeps private database failures out of the UI",async()=>{api.rpc.mockRejectedValue(new Error("private-order-reference"));expect(JSON.stringify(await getPaymentOrderForMessage(applicationId,messageId))).not.toContain("private-order");});
 it.each(["payment_paid","payment_failed","payment_canceled","payment_refund_pending","payment_refunded","payment_review_required"])("resolves the exact durable %s event even after closure",async event=>{api.rpc.mockResolvedValue({data:{applicationId,appointmentId,orderId,event},error:null});expect(await getPaymentOrderForMessage(applicationId,messageId)).toEqual({available:true,appointmentId,orderId});});
});
describe("price notice rendering hint",()=>{
 it.each([["Endpreis vorgeschlagen: 17,00 €.","proposed"],["Endpreis bestätigt: 17,00 €.","confirmed"]])("recognizes the persisted %s",(content,kind)=>expect(getPaymentSystemMessageKind({kind:"system",content})).toBe(kind));
 it.each([["Vergütung bezahlt: 17,00 €.","paid"],["Die Zahlung konnte nicht bestätigt werden.","failed"],["Der Zahlungsauftrag wurde storniert.","canceled"],["Die Erstattung wurde veranlasst.","refund_pending"],["Die Zahlung wurde vollständig erstattet.","refunded"],["Der Zahlungsvorgang wird geprüft.","review_required"]])("recognizes the verified lifecycle rendering hint %s",(content,kind)=>expect(getPaymentSystemMessageKind({kind:"system",content})).toBe(kind));
 it.each([{kind:"chat",content:"Endpreis vorgeschlagen: 17,00 €."},{kind:"system",content:"Endpreis vorgeschlagen: 17,00 €.",deleted_at:"2026-01-01"},{kind:"system",content:"Endpreis vorgeschlagen: 17,00 €.",is_temp:true},{kind:"system",content:"Endpreis vorgeschlagen: 17,00 €.",failed:true},{kind:"system",content:"Endpreis vorgeschlagen: 17.00 €."}])("never turns untrusted/stale text into a price action: %j",source=>expect(getPaymentSystemMessageKind(source)).toBeNull());
});
