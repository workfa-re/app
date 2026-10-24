import type { JobStatus } from "@/lib/types/platform";
import { getPaymentSettingsHref } from "@/lib/payments/return-path";
import { updateJobAction } from "./actions";

/** Saving before setup preserves the existing nonpublic status and every edit. */
export async function submitJobEdit({ jobId, currentStatus, formData, preparePayment }: {
    jobId: string; currentStatus: JobStatus; formData: FormData; preparePayment: boolean;
}) {
    const savedData = new FormData();
    for (const [key, value] of formData) savedData.append(key, value);
    if (preparePayment) {
        if (currentStatus !== "draft" && currentStatus !== "closed") {
            return { success: false as const, error: "Dieser Job kann hier nicht erneut veröffentlicht werden." };
        }
        savedData.set("status", currentStatus);
    }
    const result = await updateJobAction(jobId, savedData);
    if (!result.success) return result;
    return {
        success: true as const,
        nextHref: preparePayment ? getPaymentSettingsHref(`/app-home/offers/edit/${jobId}?resume=payment`) : "/app-home/offers",
    };
}
