import "server-only";
import nodemailer from "nodemailer";

/** Explicit transactional SMTP configuration, never an Auth-admin account workaround. */
export function guardianMailConfigured() {
    if (process.env.WORKFARE_DEMO_ENABLED === "true") return false;
    try { guardianSmtpOptions(); return true; } catch { return false; }
}

function guardianSmtpOptions() {
    const url = new URL(process.env.WORKFARE_GUARDIAN_SMTP_URL!);
    const from = process.env.WORKFARE_GUARDIAN_MAIL_FROM || "";
    if (!["smtp:", "smtps:"].includes(url.protocol) || (url.pathname && url.pathname !== "/") || url.search || url.hash || !url.hostname || !url.username || !url.password
        || !from || from.length > 320 || /[\r\n]/.test(from)) throw new Error("mail_configuration");
    return {
        host: url.hostname, port: Number(url.port || (url.protocol === "smtps:" ? 465 : 587)), secure: url.protocol === "smtps:",
        ...(url.username ? { auth: { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) } } : {}),
        connectionTimeout: 5_000, greetingTimeout: 5_000, socketTimeout: 10_000, requireTLS: true,
        tls: { minVersion: "TLSv1.2" },
    } as const;
}
function guardianTransport() { return nodemailer.createTransport(guardianSmtpOptions()); }

export async function sendGuardianCode(email: string, code: string) {
    if (!guardianMailConfigured()) throw new Error("mail_unavailable");
    const transport = guardianTransport();
    try {
        await transport.sendMail({
            from: process.env.WORKFARE_GUARDIAN_MAIL_FROM,
            to: email,
            subject: "Dein Bestätigungscode · Workfare",
            text: `Dein Code für die Elternfreigabe lautet: ${code}\n\nEr gilt 10 Minuten. Gib ihn nur in der von dir geöffneten Workfare-Elternfreigabe ein. Es wird kein Konto angelegt. Wenn du diese E-Mail nicht angefordert hast, ignoriere sie.`,
            disableFileAccess: true, disableUrlAccess: true,
            headers: { "X-Mailgun-Track": "no", "X-Mailgun-Track-Clicks": "no", "X-Mailgun-Track-Opens": "no" },
        });
    } finally { transport.close(); }
}

export async function sendGuardianReceipt(email: string, receiptUrl: string) {
    if (!guardianMailConfigured()) throw new Error("mail_unavailable");
    const transport = guardianTransport();
    try {
        await transport.sendMail({ from: process.env.WORKFARE_GUARDIAN_MAIL_FROM, to: email,
            subject: "Deine Elternfreigabe · Workfare",
            text: `Deine Zustimmung zur Nutzung von Workfare wurde hinterlegt. Es wurde kein Konto angelegt.\n\nÜber diesen persönlichen Link kannst du deine Zustimmung einsehen und jederzeit widerrufen:\n${receiptUrl}\n\nBewahre diese E-Mail auf und teile den Link nicht. Die Zustimmung umfasst keine Zahlungsfreigabe bei Stripe und keinen vollständigen Zugriff auf private Chats.`,
            disableFileAccess: true, disableUrlAccess: true,
            headers: { "X-Mailgun-Track": "no", "X-Mailgun-Track-Clicks": "no", "X-Mailgun-Track-Opens": "no" } });
    } finally { transport.close(); }
}
