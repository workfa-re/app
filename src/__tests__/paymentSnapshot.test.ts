import { describe, expect, it } from "vitest";
import { resolvePaymentSnapshot } from "@/components/payments/payment-snapshot";

describe("confirmed payment UI projection precedence", () => {
    const source = Object.freeze({ status: "ready", hasPayoutMethod: true });
    it("uses the delivered server projection before a local operation", () => {
        expect(resolvePaymentSnapshot(source,null)).toEqual({value:source,unknown:false});
    });
    it("can immediately revoke the shown readiness when a server operation becomes uncertain", () => {
        const value={status:"pending",hasPayoutMethod:false};
        expect(resolvePaymentSnapshot(source,{source,value,unknown:true})).toEqual({value,unknown:true});
        expect(source).toEqual({status:"ready",hasPayoutMethod:true});
    });
    it("replaces the old local operation state with a newly confirmed server response", () => {
        const refreshed={status:"restricted",hasPayoutMethod:false};
        const override={source,value:{status:"ready",hasPayoutMethod:true},unknown:false};
        expect(resolvePaymentSnapshot(refreshed,override)).toEqual({value:refreshed,unknown:false});
    });
    it("treats an equally valued new server response as a new confirmation rather than preserving old uncertainty", () => {
        const refreshed={...source};
        expect(resolvePaymentSnapshot(refreshed,{source,value:{status:"pending",hasPayoutMethod:false},unknown:true})).toEqual({value:refreshed,unknown:false});
    });
    it("never transfers a previous account's local override to another server source", () => {
        const nextAccount={status:"not_started",hasPayoutMethod:false};
        expect(resolvePaymentSnapshot(nextAccount,{source,value:source,unknown:false}).value).toBe(nextAccount);
    });
    it("keeps a failed or absent owner projection absent", () => {
        expect(resolvePaymentSnapshot(null,null)).toEqual({value:null,unknown:false});
        expect(resolvePaymentSnapshot(undefined,null)).toEqual({value:undefined,unknown:false});
    });
});
