import { Suspense } from "react";
import { GuardianLoading } from "@/components/guardian/GuardianAccess";
import { GuardianPermissionRoute } from "@/components/guardian/GuardianPermission";
export const dynamic = "force-dynamic";

export default function GuardianPermissionPage() {
    return <Suspense fallback={<GuardianLoading />}><GuardianPermissionRoute /></Suspense>;
}
