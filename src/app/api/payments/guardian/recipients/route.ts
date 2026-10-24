import { getGuardianRecipientContext,startGuardianRecipient } from "@/lib/payments/guardian-recipient.server";
import { paymentError,paymentJson,paymentExpectedOwner,readPaymentJson } from "@/lib/payments/http.server";
import { PaymentFlowError,assertPaymentRequestHost,requirePaymentRuntime } from "@/lib/payments/runtime.server";
export const runtime="nodejs";
export async function GET(request:Request){
    try{
        const paymentRuntime=requirePaymentRuntime();assertPaymentRequestHost(request,paymentRuntime);
        const {origin}=paymentRuntime,url=new URL(request.url),sent=request.headers.get("origin"),site=request.headers.get("sec-fetch-site");
        if((sent!==null && sent!==origin) || (site!==null && !["same-origin","none"].includes(site)))throw new PaymentFlowError("same_origin_required",403);
        if(url.search)throw new PaymentFlowError("invalid_request");
        return paymentJson(await getGuardianRecipientContext(paymentExpectedOwner(request)));
    }catch(error){return paymentError(error);}
}
export async function POST(request:Request){
    try{
        const input=await readPaymentJson(request,["childId","consent"]);
        const result=await startGuardianRecipient({childId:input.childId,consent:input.consent,operationId:request.headers.get("idempotency-key")},paymentExpectedOwner(request));
        const response=paymentJson(result.payload);response.headers.set("set-cookie",result.cookie);response.headers.set("Referrer-Policy","no-referrer");return response;
    }catch(error){return paymentError(error);}
}
