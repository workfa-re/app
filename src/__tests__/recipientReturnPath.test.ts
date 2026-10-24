import { describe, expect, it } from "vitest";
import { getRecipientJobReturnPath, getRecipientSettingsHref, readRecipientReturnJobId, sanitizeRecipientReturnPath } from "@/lib/payments/recipient-return-path";
const job="11111111-1111-4111-8111-111111111111";
describe("recipient setup returns only to a selected job",()=>{
    it("keeps the original job without choosing or accepting it",()=>{
        const path=`/app-home/jobs?job=${job}`;
        expect(getRecipientJobReturnPath(job)).toBe(path);expect(sanitizeRecipientReturnPath(path)).toBe(path);
        expect(getRecipientSettingsHref(job)).toBe(`/app-home/settings/payments?returnTo=${encodeURIComponent(path)}`);
        expect(readRecipientReturnJobId(job)).toBe(job);
    });
    it.each([null,undefined,[],[job],"https://other.example",`//example.org/${job}`,`/app-home/jobs?job=${job}&accept=true`,
        `/app-home/jobs?job=${job}&job=${job}`,`/app-home/jobs?job=${job}#accept`,`/app-home/jobs?job=${job}%26accept=true`,"/app-home/offers/new"])("rejects ambiguous, external or action-bearing return paths %j",value=>{
        expect(sanitizeRecipientReturnPath(value)).toBeNull();
    });
    it.each(["invalid",`../${job}`,`?job=${job}`,[job],undefined])("does not select jobs from coercible input %j",value=>{
        expect(readRecipientReturnJobId(value)).toBeNull();
    });
});
