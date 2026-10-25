import "server-only";
import nodemailer from "nodemailer";
export async function sendMembershipCancellationReceipt(
    email: string,
    reference: string,
    receivedAt: string,
    contractReference: string,
    details: {
        kind: string;
        reason: string | null;
        requestedEnd: string | null;
        name: string | null;
        confirmedUntil?: string | null;
        reviewRequired?: boolean;
        phase:"received"|"processed";
    },
) {
    const url = new URL(process.env.WORKFARE_GUARDIAN_SMTP_URL ?? "");
    const from = process.env.WORKFARE_GUARDIAN_MAIL_FROM;
    if (
        !["smtp:", "smtps:"].includes(url.protocol) ||
        !url.hostname ||
        !url.username ||
        !url.password ||
        url.search ||
        url.hash ||
        (url.pathname && url.pathname !== "/") ||
        !from ||
        /[\r\n]/.test(from)
    )
        throw new Error("membership_mail_unavailable");
    const transport = nodemailer.createTransport({
        host: url.hostname,
        port: Number(url.port || (url.protocol === "smtps:" ? 465 : 587)),
        secure: url.protocol === "smtps:",
        auth: { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) },
        requireTLS: true,
        tls: { minVersion: "TLSv1.2" },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
    });
    try {
        await transport.sendMail({
            from,
            to: email,
            messageId:`<workfare-plan-cancellation-${reference}-${details.phase}@workfa.re>`,
            subject:
                details.kind === "withdrawal"
                    ? "Dein Widerruf ist eingegangen · Workfare Plan"
                    : details.confirmedUntil && !details.reviewRequired
                      ? "Dein Workfare Plan endet · Kündigungsbestätigung"
                      : "Deine Kündigung ist eingegangen · Workfare Plan",
            text: [
                details.kind === "withdrawal"
                    ? "Wir haben deine Widerrufserklärung zu Workfare Plan erhalten."
                    : "Wir haben deine Kündigungserklärung zu Workfare Plan erhalten.",
                `Eingang: ${new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeStyle: "long", timeZone: "Europe/Berlin" }).format(new Date(receivedAt))}`,
                `Bestätigungsnummer: ${reference}`,
                `Vertragsnummer: ${contractReference}`,
                details.name ? `Name: ${details.name}` : null,
                `Art: ${details.kind === "withdrawal" ? "Widerruf" : details.kind === "extraordinary" ? "Außerordentliche Kündigung" : "Ordentliche Kündigung"}`,
                `Gewünschter Zeitpunkt: ${details.requestedEnd ?? "Zum frühestmöglichen Zeitpunkt"}`,
                details.reason ? `Begründung: ${details.reason}` : null,
                details.confirmedUntil && !details.reviewRequired
                    ? `Dein Workfare Plan endet am ${new Intl.DateTimeFormat("de-DE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Berlin" }).format(new Date(details.confirmedUntil))}. Danach verlängert er sich nicht mehr.`
                    : "Dies bestätigt den Eingang deiner Erklärung. Den rechtlich wirksamen Beendigungszeitpunkt und gegebenenfalls eine Erstattung prüfen wir anhand deines Vertrags.",
                "Du kannst diese Nachricht als Nachweis speichern.",
                "Workfare",
            ]
                .filter(Boolean)
                .join("\n\n"),
            disableFileAccess: true,
            disableUrlAccess: true,
            headers: {
                "X-Mailgun-Track": "no",
                "X-Mailgun-Track-Clicks": "no",
                "X-Mailgun-Track-Opens": "no",
            },
        });
    } finally {
        transport.close();
    }
}
