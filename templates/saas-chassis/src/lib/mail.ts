import "server-only";
import nodemailer from "nodemailer";

/**
 * Minimal mailer. With SMTP_URL unset (local dev) the message is logged instead of sent,
 * so magic links and invitations can be followed from the console.
 */
export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  const smtp = process.env.SMTP_URL;
  if (!smtp) {
    console.warn(`[mail:dev] to=${to} subject=${subject}\n${text}`);
    return;
  }
  const transport = nodemailer.createTransport(smtp);
  await transport.sendMail({
    from: process.env.MAIL_FROM ?? "no-reply@localhost",
    to,
    subject,
    text,
  });
}
