"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";
import { ActivityCommandCenter } from "@/components/activity/ActivityCommandCenter";
import {
    completeJobEngagement,
    confirmJobAgreement,
    rejectApplication,
    reopenApplication,
    reportActivityItem,
    requestConversationReopen,
    respondToConversationReopenRequest,
    sendMessage,
} from "@/app/app-home/applications/actions";
import type { Database } from "@/lib/types/supabase";

export type ProviderApplication = Database["public"]["Tables"]["applications"]["Row"] & {
    applicant?: (Database["public"]["Tables"]["profiles"]["Row"] & { avatar_url?: string | null }) | null;
    job?: {
        id: string;
        title: string;
        status: Database["public"]["Enums"]["job_status"];
    } | null;
};

export function ProviderActivityList({
    applications,
    userId,
    selectedJobId,
    selectedJobTitle,
    readOnly = false,
    paymentOrdersEnabled = false,
}: {
    applications: ProviderApplication[];
    userId: string;
    selectedJobId?: string | null;
    selectedJobTitle?: string | null;
    readOnly?: boolean;
    paymentOrdersEnabled?: boolean;
}) {
    const router = useRouter();

    const refresh = () => {
        startTransition(() => router.refresh());
    };

    const handleReject = async (applicationId: string, reason: string) => {
        const result = await rejectApplication(applicationId, reason);
        if (result?.error) throw new Error(result.error);

        refresh();
    };

    const handleSchedule = async (applicationId: string, scheduledFor: string, note?: string) => {
        const result = await confirmJobAgreement(applicationId, scheduledFor, note);
        if (result?.error) throw new Error(result.error);

        refresh();
        return result;
    };

    return (
        <ActivityCommandCenter
            applications={applications}
            role="provider"
            currentUserId={userId}
            readOnly={readOnly}
            paymentOrdersEnabled={paymentOrdersEnabled}
            selectedJobId={selectedJobId}
            selectedJobTitle={selectedJobTitle}
            onSendMessage={sendMessage}
            onReject={handleReject}
            onSchedule={handleSchedule}
            onReopen={async (applicationId) => {
                const result = await reopenApplication(applicationId);
                if (result?.error) throw new Error(result.error);
                refresh();
                return result;
            }}
            onRequestReopen={async (applicationId, message) => {
                const result = await requestConversationReopen(applicationId, message);
                if (result?.error) throw new Error(result.error);
                refresh();
                return result;
            }}
            onRespondReopenRequest={async (requestId, accept, reason) => {
                const result = await respondToConversationReopenRequest(requestId, accept, reason);
                if (result?.error) throw new Error(result.error);
                refresh();
                return result;
            }}
            onComplete={async (applicationId, reason) => {
                const result = await completeJobEngagement(applicationId, reason);
                if (result?.error) throw new Error(result.error);
                refresh();
                return result;
            }}
            onReport={reportActivityItem}
        />
    );
}
