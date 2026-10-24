import { beforeEach, describe, expect, it, vi } from "vitest";
const mock=vi.hoisted(()=>({schema:vi.fn(),auth:vi.fn(),wards:vi.fn(),Legacy:()=>null,Unavailable:()=>null,Current:()=>null}));
vi.mock("@/lib/guardian/schema-readiness.server",()=>({getGuardianSchemaState:mock.schema}));
vi.mock("@/lib/auth",()=>({getAuthState:mock.auth}));
vi.mock("@/app/actions/guardian",()=>({getWards:mock.wards}));
vi.mock("@/components/guardian/GuardianAccess",()=>({GuardianAccessRoute:mock.Current,GuardianLoading:()=>null}));
vi.mock("@/components/guardian/LegacyGuardianAccess",()=>({LegacyGuardianAccess:mock.Legacy,GuardianReleaseUnavailable:mock.Unavailable}));
import {GuardianEntry} from "@/components/guardian/GuardianEntry";
const provider={id:"parent",account_type:"job_provider",provider_kind:"private",full_name:"Paula Beispiel",birthdate:"1980-01-01",city:"Rheinbach"};
describe("family route during database rollout",()=>{
 beforeEach(()=>{vi.resetAllMocks();mock.schema.mockResolvedValue("legacy");mock.auth.mockResolvedValue({state:"ready",profile:provider});mock.wards.mockResolvedValue({wards:[{full_name:"Own Child"}]});});
 it("renders the new purpose flow only with explicit readiness",async()=>{mock.schema.mockResolvedValue("ready");const result=await GuardianEntry();expect(result.props.children.type).toBe(mock.Current);expect(mock.auth).not.toHaveBeenCalled();expect(mock.wards).not.toHaveBeenCalled();});
 it("closes the purpose login on an unknown, partial or failed schema",async()=>{mock.schema.mockResolvedValue("unavailable");expect((await GuardianEntry()).type).toBe(mock.Unavailable);expect(mock.auth).not.toHaveBeenCalled();});
 it("keeps the existing complete-provider confirmation path and only own linked children",async()=>{const result=await GuardianEntry();expect(result.props.children.type).toBe(mock.Legacy);expect(result.props.children.props).toMatchObject({authenticated:true,eligible:true,name:"Paula Beispiel",childrenNames:["Own Child"]});});
 it.each([{state:"no-session"},{state:"email-unconfirmed",profile:provider}])("does not reveal legacy family names before confirmed authentication",async auth=>{mock.auth.mockResolvedValue(auth);const result=await GuardianEntry();expect(result.props.children.props).toMatchObject({authenticated:false,eligible:false,name:null,childrenNames:[]});expect(mock.wards).not.toHaveBeenCalled();});
 it("does not offer parent confirmation to the signed-in child",async()=>{mock.auth.mockResolvedValue({state:"ready",profile:{...provider,account_type:"job_seeker",provider_kind:null,birthdate:"2010-01-01"}});const result=await GuardianEntry();expect(result.props.children.props).toMatchObject({authenticated:true,eligible:false,childrenNames:[]});expect(mock.wards).not.toHaveBeenCalled();});
});
