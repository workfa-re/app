import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/lib/supabaseClient",()=>({supabaseBrowser:{}}));
vi.mock("@/app/app-home/applications/actions",()=>({markApplicationMessagesRead:vi.fn()}));
vi.mock("@/components/profile/UserProfileModal",()=>({UserProfileModal:()=>null}));
vi.mock("@/components/activity/ChatAppointments",()=>({ChatAppointments:()=>null}));
vi.mock("@/components/activity/useAppointmentRequests",()=>({useAppointmentRequests:()=>({requests:[],available:true})}));
import { ScheduleDialog } from "@/components/activity/ApplicationChat";
const render=(props:Record<string,unknown>={})=>renderToStaticMarkup(<ScheduleDialog value="2030-10-25T23:00" setValue={vi.fn()} note="" setNote={vi.fn()} pending={false} error={null} isEditing={false} isRecurring={false} onCancel={vi.fn()} onConfirm={vi.fn()} {...props}/>);
describe("clear appointment scheduling",()=>{
 it("presents separate labeled date/time fields and a single clear primary action",()=>{const html=render();expect(html).toContain('type="date"');expect(html).toContain('type="time"');expect(html).toContain('value="23:00"');expect(html).toContain('value="2030-10-25"');expect(html).toContain("Wann soll die Arbeit stattfinden?");expect(html).not.toContain("verbindlich festlegen");expect(html).not.toContain("Die Vereinbarung wird");});
 it("keeps the optional note collapsed instead of presenting another required field",()=>{const html=render();expect(html).toContain('<details class="activity-schedule-note">');expect(html).toContain("Notiz ergänzen");});
 it("shows an existing note on edit",()=>{expect(render({note:"Am Gartentor"})).toContain('class="activity-schedule-note" open=""');});
 it("blocks saving an incomplete timestamp and preserves errors",()=>{const html=render({value:"2030-10-25T",error:"Bitte wähle eine Uhrzeit."});expect(html).toContain('class="is-primary" disabled=""');expect(html).toContain('role="alert"');expect(html).toContain("Bitte wähle eine Uhrzeit.");});
});
