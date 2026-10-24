import {describe,expect,it} from "vitest";
import {getPaymentConversationReturnPath,getPaymentSettingsHref,sanitizePaymentReturnPath} from "@/lib/payments/return-path";
const application="11111111-1111-4111-8111-111111111111";
describe("exact chat payment setup return",()=>{
    it("keeps the original conversation through setup without inventing a success state",()=>{
        const path=`/app-home/activities?conversation=${application}`;
        expect(getPaymentConversationReturnPath(application)).toBe(path);
        expect(sanitizePaymentReturnPath(path)).toBe(path);
        expect(new URL(getPaymentSettingsHref(path),"http://localhost").searchParams.get("returnTo")).toBe(path);
    });
    it.each([`//evil.example/app-home/activities?conversation=${application}`,`/app-home/activities?conversation=${application}&status=paid`,
        `/app-home/activities?conversation=${application}#secret`,`/app-home/activities?conversation=${application}%26other=1`,
        `/app-home/activities?conversation=${application}&conversation=${application}`,"/app-home/activities?conversation=not-a-uuid"])("rejects expanded or untrusted chat returns (%s)",path=>{
        expect(sanitizePaymentReturnPath(path)).toBeNull();
    });
});
