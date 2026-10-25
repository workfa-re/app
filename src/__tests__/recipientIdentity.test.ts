import {describe,it,expect} from "vitest";
import {recipientIdentityUnchanged} from "@/lib/payments/recipient-identity";
import type {RecipientRecord} from "@/lib/payments/recipient-types";
const record:RecipientRecord={id:"row",userId:"owner",mode:"live",accountRef:"acct_fixture",generation:1,birthdate:"2010-01-01",displayName:"Child Fixture",minorBinding:{guardianId:"parent",consentId:"consent",childBirthdate:"2010-01-01",guardianBirthdate:"1980-01-01",guardianName:"Parent Fixture",guardianEmail:"parent@example.test"}};
describe("recipient identity boundary",()=>{
 it("allows a newer observation and changed requirement result for identical people and consent",()=>{expect(recipientIdentityUnchanged(record,{...record,generation:9,guardianReason:"guardian_kyc_required"})).toBe(true);});
 it.each([null,{...record,userId:"other"},{...record,mode:"sandbox" as const},{...record,accountRef:"acct_other"},{...record,birthdate:"2009-01-01"},{...record,displayName:"Other Child"},{...record,minorBinding:null},{...record,minorBinding:{...record.minorBinding!,consentId:"newConsent"}}])("refuses a real identity or consent change",changed=>{expect(recipientIdentityUnchanged(record,changed)).toBe(false);});
});
