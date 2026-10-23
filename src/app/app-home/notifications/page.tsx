import { redirect } from "next/navigation";
import { getAppHomeContext, getDefaultAppHomePath } from "@/lib/app-shell";

/** Existing links open the same center over the account's home, without a second inbox. */
export default async function NotificationsPage() {
    const { effectiveView } = await getAppHomeContext();
    redirect(`${getDefaultAppHomePath(effectiveView.viewRole)}?notifications=open`);
}
