import { refreshGuardianRecipient } from "@/lib/payments/guardian-recipient.server";
import { paymentError } from "@/lib/payments/http.server";
import { PaymentFlowError,requirePaymentRuntime } from "@/lib/payments/runtime.server";
export const runtime="nodejs";
export async function GET(request:Request){
    try{
        const {origin}=requirePaymentRuntime(),url=new URL(request.url),sent=request.headers.get("origin");
        if(url.origin!==origin || url.search || (sent!==null && sent!==origin))throw new PaymentFlowError("same_origin_required",403);
        if(request.headers.get("sec-fetch-site")==="cross-site" && (request.headers.get("sec-fetch-mode")!=="navigate" || request.headers.get("sec-fetch-dest")!=="document"))throw new PaymentFlowError("same_origin_required",403);
        const result=await refreshGuardianRecipient(request.headers.get("cookie"));
        return new Response(null,{status:303,headers:{Location:result.url,"Cache-Control":"private, no-store, max-age=0","Referrer-Policy":"no-referrer"}});
    }catch(error){return paymentError(error);}
}
