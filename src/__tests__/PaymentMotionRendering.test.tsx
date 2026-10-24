import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
const theme=vi.hoisted(()=>({resolvedTheme:"light",isHydrated:false}));
vi.mock("@/components/providers/ThemeProvider",()=>({useTheme:()=>theme}));
vi.mock("next/image",()=>({default:(props:Record<string,unknown>)=>createElement("img",{...props,fill:undefined,sizes:undefined})}));
import { PaymentMotion } from "@/components/payments/PaymentMotion";

describe("decorative Workfare Pay motion",()=>{
    it.each(["light","dark"])("keeps a versioned still fallback without fetching or autoplaying a video during initial %s rendering",resolvedTheme=>{
        Object.assign(theme,{resolvedTheme,isHydrated:false});
        const html=renderToStaticMarkup(<PaymentMotion/>);
        expect(html).toContain('/media/pay/workfare-pay-bridge-v2-light.jpg');
        expect(html).toContain('/media/pay/workfare-pay-bridge-v2-dark.jpg');
        expect(html).toMatch(/<video[^>]*muted=""[^>]*playsInline=""[^>]*loop=""[^>]*preload="none"/);
        expect(html).not.toMatch(/<video[^>]*\ssrc=/);expect(html).not.toMatch(/\sautoPlay=|\scontrols=|<iframe/);
        expect(html).toContain('aria-label="Animation abspielen"');expect(html).toContain('aria-pressed="false"');
        expect(html).toContain('aria-hidden="true"');expect(html).not.toContain('workfare-pay-glass-');
    });
    it("leaves the hydrated video unloaded until a motion preference or explicit play action enables it",()=>{
        Object.assign(theme,{resolvedTheme:"dark",isHydrated:true});
        const html=renderToStaticMarkup(<PaymentMotion/>);
        expect(html).not.toMatch(/<video[^>]*\ssrc=/);
        expect(html).toContain('poster="/media/pay/workfare-pay-bridge-v2-dark.jpg"');
    });
});
