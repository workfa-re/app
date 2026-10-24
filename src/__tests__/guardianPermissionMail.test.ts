import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ create: vi.fn(), send: vi.fn(), close: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("nodemailer", () => ({ default: { createTransport: mock.create } }));
import { guardianMailConfigured, sendGuardianCode, sendGuardianReceipt } from "@/lib/guardian/permission-mail.server";
describe("private guardian SMTP adapter", () => {
    beforeEach(() => {
        vi.resetAllMocks(); vi.stubEnv("WORKFARE_DEMO_ENABLED", "false");
        vi.stubEnv("WORKFARE_GUARDIAN_MAIL_FROM", "Workfare <freigabe@example.invalid>");
        vi.stubEnv("WORKFARE_GUARDIAN_SMTP_URL", "smtp://postmaster%40example.invalid:fake-disposable-password@smtp.eu.mailgun.org:587");
        mock.create.mockReturnValue({ sendMail: mock.send, close: mock.close }); mock.send.mockResolvedValue({ accepted: ["parent@example.invalid"] });
    });
    afterEach(() => vi.unstubAllEnvs());
    it("uses private domain SMTP credentials with mandatory TLS and bounded timeouts", async () => {
        expect(guardianMailConfigured()).toBe(true); await sendGuardianCode("parent@example.invalid", "12345678");
        expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.eu.mailgun.org", port: 587, secure: false, requireTLS: true, tls: { minVersion: "TLSv1.2" }, auth: { user: "postmaster@example.invalid", pass: "fake-disposable-password" }, socketTimeout: 10_000 }));
        expect(mock.send.mock.calls[0][0]).toMatchObject({ to: "parent@example.invalid", from: "Workfare <freigabe@example.invalid>", disableFileAccess: true, disableUrlAccess: true, headers: { "X-Mailgun-Track": "no", "X-Mailgun-Track-Clicks": "no", "X-Mailgun-Track-Opens": "no" } });
        expect(mock.send.mock.calls[0][0].text).toContain("\n\n"); expect(mock.close).toHaveBeenCalledOnce();
    });
    it("supports a US-domain SMTP host with direct TLS on 465 without forcing the wrong region", async () => {
        vi.stubEnv("WORKFARE_GUARDIAN_SMTP_URL", "smtps://postmaster%40example.invalid:fake-password@smtp.mailgun.org:465");
        await sendGuardianReceipt("parent@example.invalid", "https://app.workfa.re/guardian/permission?receipt=private-receipt");
        expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.mailgun.org", secure: true, port: 465 }));
        expect(mock.send.mock.calls[0][0].text).toContain("private-receipt");
    });
    it.each([undefined, "https://not-smtp.invalid", "smtp://smtp.eu.mailgun.org:587"])("fails closed on missing or malformed private mail configuration", async url => {
        vi.stubEnv("WORKFARE_GUARDIAN_SMTP_URL", url);
        expect(guardianMailConfigured()).toBe(false); await expect(sendGuardianCode("parent@example.invalid", "12345678")).rejects.toThrow("mail_unavailable");
        expect(mock.create).not.toHaveBeenCalled();
    });
    it("never sends from a local or hosted demo, even if SMTP environment values exist", async () => {
        vi.stubEnv("WORKFARE_DEMO_ENABLED", "true"); expect(guardianMailConfigured()).toBe(false);
        await expect(sendGuardianReceipt("parent@example.invalid", "https://app.workfa.re/guardian/permission?receipt=x")).rejects.toThrow("mail_unavailable");
        expect(mock.create).not.toHaveBeenCalled();
    });
    it("closes the transport after failure without logging credential-bearing diagnostics", async () => {
        mock.send.mockRejectedValue(new Error("fake transport failed"));
        await expect(sendGuardianCode("parent@example.invalid", "12345678")).rejects.toThrow("fake transport failed");
        expect(mock.close).toHaveBeenCalledOnce();
    });
});
