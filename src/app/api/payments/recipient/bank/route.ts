import { assertPaymentRequestHost, PaymentFlowError, requirePaymentRuntime } from "@/lib/payments/runtime.server";
import { paymentError,paymentExpectedOwner,paymentJson,readPaymentJson } from "@/lib/payments/http.server";
import { readMinorBankSetup,startMinorBankSetup } from "@/lib/payments/minor-bank.server";

export const runtime="nodejs";
export async function GET(request:Request){
    try{
        const runtime=requirePaymentRuntime();
        assertPaymentRequestHost(request,runtime);
        const origin=request.headers.get("origin"),site=request.headers.get("sec-fetch-site");
        if(origin!==null&&origin!==runtime.origin||site!==null&&!["same-origin","none"].includes(site))throw new PaymentFlowError("same_origin_required",403);
        if(new URL(request.url).search)throw new PaymentFlowError("invalid_request");
        return paymentJson(await readMinorBankSetup(paymentExpectedOwner(request)));
    }catch(error){return paymentError(error);}
}
export async function POST(request:Request){
    try{
        const input=await readPaymentJson(request,["consent","bankToken","guardianId","restart"]);
        return paymentJson(await startMinorBankSetup({...input,consent:input.consent,operationId:request.headers.get("idempotency-key")},paymentExpectedOwner(request)));
    }catch(error){return paymentError(error);}
}
