import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ setTheme: vi.fn(), cleanup: undefined as (() => void) | undefined }));
vi.mock("react", () => ({ useEffect: (effect: () => (() => void) | void) => { state.cleanup = effect() || undefined; } }));
vi.mock("@/components/providers/ThemeProvider", () => ({ useTheme: () => ({ setTheme: state.setTheme }) }));
import { DemoEmbedBridge, type DemoEmbedRole } from "@/components/demo/DemoEmbedBridge";

const postMessage = vi.fn();
const addEventListener = vi.fn();
const removeEventListener = vi.fn();
function render(referrer: string, role: DemoEmbedRole | null = "seeker", allowDevelopmentOrigins = false) {
  vi.stubGlobal("window", { parent: { postMessage }, addEventListener, removeEventListener, location: { protocol: "https:" } });
  vi.stubGlobal("document", { referrer });
  return DemoEmbedBridge({ role, allowDevelopmentOrigins });
}
beforeEach(() => { vi.clearAllMocks(); state.cleanup = undefined; });
afterEach(() => vi.unstubAllGlobals());

describe("actual app embed readiness", () => {
  it.each(["https://workfa.re", "https://www.workfa.re"])("signals only the exact allowed parent %s", (parentOrigin) => {
    expect(render(`${parentOrigin}/?campaign=fixture`, "company")).toBeNull();
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: "workfare:demo-ready", role: "company" }, parentOrigin);
  });
  it.each(["seeker", "private-provider", "company"] as const)("forwards the actual profile role %s without account data", (role) => {
    render("https://workfa.re", role);
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: "workfare:demo-ready", role }, "https://workfa.re");
  });
  it.each(["http://localhost:3000", "http://127.0.0.1:3000"])("requires explicit development permission for %s", (origin) => {
    render(origin);
    expect(postMessage).not.toHaveBeenCalled();
    render(origin, "private-provider", true);
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: "workfare:demo-ready", role: "private-provider" }, origin);
  });
  it.each(["", "not a URL", "https://workfa.re.evil.test", "https://evil.test/?parent=https://workfa.re", "http://workfa.re", "https://workfa.re:444", "http://localhost:3001", "http://127.0.0.2:3000"])(
    "never signals an untrusted referrer %s", (referrer) => {
      render(referrer, "seeker", true);
      expect(postMessage).not.toHaveBeenCalled();
    },
  );
  it("waits for an actual profile", () => {
    render("https://workfa.re", null);
    expect(postMessage).not.toHaveBeenCalled();
  });
  it("does not post on a direct visit", () => {
    const browserWindow = { postMessage } as { postMessage: typeof postMessage; parent?: unknown };
    browserWindow.parent = browserWindow;
    vi.stubGlobal("window", browserWindow);
    vi.stubGlobal("document", { referrer: "https://workfa.re" });
    expect(DemoEmbedBridge({ role: "seeker", allowDevelopmentOrigins: false })).toBeNull();
    expect(postMessage).not.toHaveBeenCalled();
  });
});


describe("website theme synchronization", () => {
  function dispatch(data: unknown, origin = "https://workfa.re", source: unknown = window.parent) {
    const listener = addEventListener.mock.calls.find(([name]) => name === "message")?.[1];
    listener?.({ data, origin, source });
  }
  it("repeats readiness when the trusted parent hydrates after the iframe", () => {
    render("https://workfa.re/demo", "company");
    postMessage.mockClear();
    dispatch({ type: "workfare:demo-ready-request" });
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: "workfare:demo-ready", role: "company" }, "https://workfa.re");
    expect(state.setTheme).not.toHaveBeenCalled();
    expect(document.cookie).toBeUndefined();
  });
  it("never answers a readiness request from a different origin or window", () => {
    render("https://workfa.re/demo");
    postMessage.mockClear();
    dispatch({ type: "workfare:demo-ready-request" }, "https://evil.example");
    dispatch({ type: "workfare:demo-ready-request" }, "https://workfa.re", { postMessage });
    expect(postMessage).not.toHaveBeenCalled();
    expect(state.setTheme).not.toHaveBeenCalled();
    expect(document.cookie).toBeUndefined();
  });
  it("never acknowledges a theme message with readiness, preventing a message loop", () => {
    render("https://workfa.re/demo");
    postMessage.mockClear();
    dispatch({ type: "workfare:demo-theme", theme: "light" });
    expect(state.setTheme).toHaveBeenCalledExactlyOnceWith("light");
    expect(postMessage).not.toHaveBeenCalled();
  });
  it.each(["dark", "light"])("applies %s from the trusted parent and persists only the cosmetic cookie", (theme) => {
    render("https://workfa.re/demo");
    dispatch({ type: "workfare:demo-theme", theme });
    expect(state.setTheme).toHaveBeenCalledExactlyOnceWith(theme);
    expect(document.cookie).toBe(`wf-demo-theme=${theme}; Path=/; Max-Age=86400; SameSite=Lax; Secure`);
    expect(addEventListener.mock.invocationCallOrder[0]).toBeLessThan(postMessage.mock.invocationCallOrder[0]);
    const listener = addEventListener.mock.calls[0][1];
    state.cleanup?.();
    expect(removeEventListener).toHaveBeenCalledExactlyOnceWith("message", listener);
  });
  it("supports localhost without a Secure cookie and does not add another session", () => {
    render("http://localhost:3000/demo", "seeker", true);
    window.location.protocol = "http:";
    dispatch({ type: "workfare:demo-theme", theme: "light" }, "http://localhost:3000");
    expect(state.setTheme).toHaveBeenCalledExactlyOnceWith("light");
    expect(document.cookie).toBe("wf-demo-theme=light; Path=/; Max-Age=86400; SameSite=Lax");
    expect(postMessage).toHaveBeenCalledOnce();
  });
  it.each([null, "dark", [], {}, { type: "workfare:demo-ready", theme: "dark" }, { type: "workfare:demo-theme" }, { type: "workfare:demo-theme", theme: "system" }, { type: "workfare:demo-theme", theme: "LIGHT" }, { type: "workfare:demo-theme", theme: "dark; auth=forged" }])("ignores malformed or unsupported payload %j", (data) => {
    render("https://workfa.re/demo");
    dispatch(data);
    expect(state.setTheme).not.toHaveBeenCalled();
    expect(document.cookie).toBeUndefined();
  });
  it.each(["https://evil.example", "https://workfa.re.evil.example", "http://workfa.re", "https://www.workfa.re"])("ignores a different origin even with the parent source: %s", (origin) => {
    render("https://workfa.re/demo");
    dispatch({ type: "workfare:demo-theme", theme: "light" }, origin);
    expect(state.setTheme).not.toHaveBeenCalled();
    expect(document.cookie).toBeUndefined();
  });
  it("ignores a sibling or other sender claiming the allowed origin", () => {
    render("https://workfa.re/demo");
    dispatch({ type: "workfare:demo-theme", theme: "light" }, "https://workfa.re", { postMessage });
    expect(state.setTheme).not.toHaveBeenCalled();
    expect(document.cookie).toBeUndefined();
  });
  it("does not install a listener for an untrusted embedding website", () => {
    render("https://evil.example/demo");
    expect(addEventListener).not.toHaveBeenCalled();
    expect(state.setTheme).not.toHaveBeenCalled();
  });
});
