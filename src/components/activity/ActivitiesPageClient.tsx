"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";
import { ActivityCommandCenter } from "@/components/activity/ActivityCommandCenter";
import {
    reopenApplication,
    reportActivityItem,
    requestConversationReopen,
    respondToConversationReopenRequest,
    sendMessage,
    withdrawApplication,
} from "@/app/app-home/applications/actions";

interface ActivitiesPageClientProps {
    applications: any[];
    userId: string;
    readOnly?: boolean;
}

export function ActivitiesPageClient({ applications, userId, readOnly = false }: ActivitiesPageClientProps) {
    const router = useRouter();

    const refresh = () => {
        startTransition(() => router.refresh());
    };

    const handleWithdraw = async (applicationId: string, reason: string) => {
        const result = await withdrawApplication(applicationId, reason);
        if (result?.error) throw new Error(result.error);

        refresh();
    };

    return (
        <ActivityCommandCenter
            applications={applications}
            role="seeker"
            currentUserId={userId}
            readOnly={readOnly}
            onSendMessage={sendMessage}
            onWithdraw={handleWithdraw}
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
            onReport={reportActivityItem}
        />
    );
}
