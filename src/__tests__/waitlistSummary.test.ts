import { describe, expect, it } from "vitest";
import {
    mergeWaitlistJobSummaries,
    type JobsListItem,
    type WaitlistJobSummary,
} from "@/lib/types/platform";

function makeJob(id: string, status: JobsListItem["status"] = "reserved"): JobsListItem {
    return {
        id,
        title: `Job ${id}`,
        description: null,
        posted_by: "provider-id",
        status,
        created_at: "2026-07-15T10:00:00.000Z",
        market_id: "market-id",
        public_location_label: "Rheinbach",
        wage_hourly: 15,
    };
}

describe("waitlist job summaries", () => {
    it("merges aggregate queue data and the current user's own gapless rank", () => {
        const jobs = [makeJob("reserved-job")];
        const summaries: WaitlistJobSummary[] = [{
            job_id: "reserved-job",
            waitlist_count: 4,
            next_position: 5,
            conversation_active: true,
            my_waitlist_position: 2,
        }];

        const [result] = mergeWaitlistJobSummaries(jobs, summaries);

        expect(result).toMatchObject({
            waitlist_count: 4,
            next_position: 5,
            conversation_active: true,
            my_waitlist_position: 2,
        });
        expect(jobs[0].waitlist_count).toBeUndefined();
    });

    it("keeps another user's position private and leaves unrelated jobs untouched", () => {
        const reservedJob = makeJob("reserved-job");
        const openJob = makeJob("open-job", "open");
        const summaries: WaitlistJobSummary[] = [{
            job_id: "reserved-job",
            waitlist_count: 3,
            next_position: 4,
            conversation_active: true,
            my_waitlist_position: null,
        }];

        const [reservedResult, openResult] = mergeWaitlistJobSummaries(
            [reservedJob, openJob],
            summaries,
        );

        expect(reservedResult.my_waitlist_position).toBeNull();
        expect(reservedResult.waitlist_count).toBe(3);
        expect(openResult).toBe(openJob);
    });
});
