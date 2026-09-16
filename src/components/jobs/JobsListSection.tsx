import { memo } from "react";
import { JobCard } from "@/components/jobs/JobCard";
import { cn } from "@/lib/utils";
import type { JobsListItem } from "@/lib/types/platform";

interface SectionProps {
    title: string;
    icon?: any;
    colorClass: string;
    jobs: JobsListItem[];
    emptyMsg: React.ReactNode;
    hiddenOnMobile?: boolean;
    isWhiteTitle?: boolean;
    canApply: boolean;
    hideStatusLabel?: boolean;
    isExtendedSection?: boolean;
    onSelect: (job: JobsListItem) => void;
}

export const JobsListSection = memo(function JobsListSection({
    title,
    icon: Icon,
    colorClass,
    jobs,
    emptyMsg,
    hiddenOnMobile,
    isWhiteTitle,
    canApply,
    hideStatusLabel,
    isExtendedSection,
    onSelect
}: SectionProps) {
    return (
        <div className={cn("jobs-section space-y-6", hiddenOnMobile ? "hidden lg:block" : "")}>
            <div className="jobs-section-heading-row flex items-center">
                <h2 className={cn("jobs-section-heading flex min-w-0 items-center gap-2.5 text-2xl font-bold tracking-[-0.01em]", isWhiteTitle ? "text-white" : colorClass)}>
                    {Icon && (
                        <div className={cn("jobs-section-icon rounded-lg border p-2", isWhiteTitle ? "border-white/10 bg-white/10 text-indigo-400" : "border-white/10 bg-white/5")}>
                            <Icon size={18} />
                        </div>
                    )}
                    <span className="truncate">{title}</span>
                    <span className="jobs-section-count rounded-full bg-white/10 px-3 py-1 text-sm font-semibold tracking-normal text-slate-400">
                        {jobs.length}
                    </span>
                </h2>
            </div>

            <div className="jobs-card-grid grid grid-cols-1 gap-6 lg:grid-cols-2">
                {jobs.length === 0 ? (
                    <div className="jobs-empty-state col-span-full flex min-h-[17.5rem] items-center justify-center overflow-hidden rounded-[1.5rem] border-0 px-5 py-10 text-center">
                        <div className="w-full">{emptyMsg}</div>
                    </div>
                ) : (
                    jobs.map(job => (
                        <div
                            key={job.id}
                            className="job-card-shell relative min-w-0"
                        >
                            <JobCard
                                job={job}
                                isApplied={title === 'Bereits Beworben'}
                                isLocked={!canApply}
                                hideStatusLabel={hideStatusLabel}
                                isCrossRegionalBadge={isExtendedSection}
                                onSelect={onSelect}
                            />
                        </div>
                    ))
                )}
            </div>
        </div>
    );
});
