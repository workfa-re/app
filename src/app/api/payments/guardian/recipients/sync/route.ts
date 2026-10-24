import { syncGuardianRecipient } from "@/lib/payments/guardian-recipient.server";
import { paymentError,paymentJson,paymentExpectedOwner,readPaymentJson } from "@/lib/payments/http.server";
export const runtime="nodejs";
export async function POST(request:Request){
    try{const input=await readPaymentJson(request,["childId"]);return paymentJson(await syncGuardianRecipient(input.childId,paymentExpectedOwner(request)));}
    catch(error){return paymentError(error);}
}
