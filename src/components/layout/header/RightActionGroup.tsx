import { ProfileChip } from "../ProfileChip";
import { NotificationsPopover } from "@/components/notifications/NotificationsPopover";
import type { AppHeaderProfile, HeaderNotificationItem } from "@/lib/types/platform";

export function RightActionGroup({
    profile,
    isStaff,
    accountEmail,
    unreadCount,
    notificationsPreview,
}: {
    profile: AppHeaderProfile | null;
    isStaff: boolean;
    accountEmail: string | null;
    unreadCount: number;
    notificationsPreview: HeaderNotificationItem[];
}) {
    return (
        <div className="flex items-center gap-2 min-[420px]:gap-3">
            <NotificationsPopover
                currentUserId={profile?.id ?? null}
                initialUnreadCount={unreadCount}
                initialNotifications={notificationsPreview}
            />
            <ProfileChip
                profile={profile}
                isStaff={isStaff}
                accountEmail={accountEmail}
            />
        </div>
    );
}
