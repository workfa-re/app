import { beforeEach, describe, expect, it, vi } from "vitest";
const mock=vi.hoisted(()=>({getUser:vi.fn(),rpc:vi.fn(),from:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabaseServer",()=>({supabaseServer:async()=>({auth:{getUser:mock.getUser},rpc:mock.rpc,from:mock.from})}));
import { getGuardianApplicationAccess } from "@/lib/guardian/access-state.server";
const user={id:"a0afddfd-8e98-43da-ac77-7bc1ddb17b7b",email_confirmed_at:"2026-10-24T09:00:00Z"};
describe("minimal server-owned guardian application access",()=>{
 beforeEach(()=>{vi.resetAllMocks();mock.getUser.mockResolvedValue({data:{user},error:null});});
 it("does not accept a caller target id",async()=>{mock.rpc.mockResolvedValue({data:{guardianStatus:"none",hasActiveGuardian:false,canApply:true,isVerified:false},error:null});expect(await Reflect.apply(getGuardianApplicationAccess,null,["other-user"])).toEqual({guardianStatus:"none",hasActiveGuardian:false,canApply:true,isVerified:false});expect(mock.rpc).toHaveBeenCalledWith("get_guardian_application_access");});
 it("fails closed when the RPC is missing",async()=>{mock.rpc.mockResolvedValue({data:null,error:{code:"PGRST202"}});expect(await getGuardianApplicationAccess()).toBeNull();});
 it.each([{guardianStatus:"linked",hasActiveGuardian:false,canApply:true,isVerified:false},{guardianStatus:"none",hasActiveGuardian:false,canApply:false,isVerified:true},{canApply:"true"}])("rejects malformed or contradictory projections",async(data)=>{mock.rpc.mockResolvedValue({data,error:null});expect(await getGuardianApplicationAccess()).toBeNull();});
 it("requires verified current auth identity",async()=>{mock.getUser.mockResolvedValue({data:{user:null},error:null});expect(await getGuardianApplicationAccess()).toBeNull();expect(mock.rpc).not.toHaveBeenCalled();});
 it("ignores a user object when Auth returned an error",async()=>{mock.getUser.mockResolvedValue({data:{user},error:{code:"bad_jwt"}});expect(await getGuardianApplicationAccess()).toBeNull();expect(mock.rpc).not.toHaveBeenCalled();});
 it("preserves the existing owner-scoped application projection only for a completely old schema",async()=>{
  mock.rpc.mockImplementation(async name=>({data:null,error:{code:"PGRST202",message:`Could not find the function public.${name} without parameters in the schema cache`}}));
  const filters:Array<[string,unknown]>=[];
  mock.from.mockImplementation(table=>{const result=table==="profiles"?{data:{id:user.id,account_type:"job_seeker",birthdate:"2010-01-01"},error:null}:{data:[{child_id:user.id}],error:null};const builder={select:()=>builder,eq:(key:string,value:unknown)=>{filters.push([key,value]);return builder;},limit:async()=>result,maybeSingle:async()=>result};return builder;});
  expect(await getGuardianApplicationAccess()).toEqual({guardianStatus:"linked",hasActiveGuardian:true,canApply:true,isVerified:true});
  expect(filters).toContainEqual(["id",user.id]);expect(filters).toContainEqual(["child_id",user.id]);expect(filters).toContainEqual(["status","active"]);
 });
 it("does not fall back to relationships when a new RPC fails or schema is partially deployed",async()=>{
  mock.rpc.mockResolvedValue({data:null,error:{code:"42501",message:"permission denied"}});expect(await getGuardianApplicationAccess()).toBeNull();expect(mock.from).not.toHaveBeenCalled();
  mock.rpc.mockImplementation(async name=>name==="get_guardian_access_context"?{data:{authenticated:true},error:null}:{data:null,error:{code:"PGRST202",message:`Could not find the function public.${name} without parameters in the schema cache`}});
  expect(await getGuardianApplicationAccess()).toBeNull();expect(mock.from).not.toHaveBeenCalled();
 });
});
