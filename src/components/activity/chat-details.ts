import type { ActivityMessage } from "@/lib/activity/chat";
import { formatJobCompensation } from "@/components/jobs/job-presentation";

export function formatChatCompensation(value: unknown, paymentType?: string | null) {
    const { amount, unit } = formatJobCompensation(typeof value === "number" ? value : null, paymentType);
    return amount ? `${amount} ${unit}` : "Vergütung offen";
}

/** Literal matching keeps punctuation and user-supplied regex characters harmless. */
export function splitChatHighlight(text: string, query: string): { text: string; match: boolean }[] {
    const term = query.trim();
    if (!term) return [{ text, match: false }];
    const needle = term.toLocaleLowerCase("de-DE");
    const haystack = text.toLocaleLowerCase("de-DE");
    const parts: { text: string; match: boolean }[] = [];
    let cursor = 0;
    let next = haystack.indexOf(needle);
    while (next >= 0) {
        if (next > cursor) parts.push({ text: text.slice(cursor, next), match: false });
        parts.push({ text: text.slice(next, next + term.length), match: true });
        cursor = next + term.length;
        next = haystack.indexOf(needle, cursor);
    }
    if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
    return parts.length ? parts : [{ text, match: false }];
}

export function findChatMessages(messages: ActivityMessage[], query: string) {
    const needle = query.trim().toLocaleLowerCase("de-DE");
    if (!needle) return [];
    return messages.filter(message => !message.is_temp && !message.deleted_at && message.content.toLocaleLowerCase("de-DE").includes(needle)).slice().reverse();
}

export function chatSearchExcerpt(content: string, query: string) {
    const match = content.toLocaleLowerCase("de-DE").indexOf(query.trim().toLocaleLowerCase("de-DE"));
    if (match < 0) return content;
    const start = Math.max(0, match - 45);
    const end = Math.min(content.length, match + query.trim().length + 100);
    return `${start ? "…" : ""}${content.slice(start, end)}${end < content.length ? "…" : ""}`;
}

export type ChatAppointment = { id: string; starts_at: string; status: string; note?: string | null; ends_at?: string | null; updated_at?: string | null };

export function orderChatAppointments(appointments: ChatAppointment[], fallback?: string | null, note?: string | null, now = Date.now()) {
    const valid = appointments.filter(item => Number.isFinite(new Date(item.starts_at).getTime()));
    if (fallback && Number.isFinite(new Date(fallback).getTime()) && !valid.some(item => new Date(item.starts_at).getTime() === new Date(fallback).getTime())) {
        valid.push({ id: "agreed-appointment", starts_at: fallback, status: "scheduled", note });
    }
    return valid.sort((a, b) => {
        const aTime = new Date(a.starts_at).getTime();
        const bTime = new Date(b.starts_at).getTime();
        const aUpcoming = a.status === "scheduled" && aTime >= now;
        const bUpcoming = b.status === "scheduled" && bTime >= now;
        if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
        return aUpcoming ? aTime - bTime : bTime - aTime;
    });
}
