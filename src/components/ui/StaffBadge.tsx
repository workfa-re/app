import { ShieldCheck } from "lucide-react";

export function StaffBadge({ className = "" }: { className?: string }) {
    return (
        <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 whitespace-nowrap ${className}`}
            title="Offizieller Workfare Mitarbeiter"
        >
            <ShieldCheck size={10} className="shrink-0" />
            <span>Team</span>
        </span>
    );
}
