import nodemailer from "nodemailer";

/** Signup code lifetime. */
export const SIGNUP_CODE_TTL_MS = 30 * 60 * 1000;

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_FROM?.trim());
}

export async function sendSignupCode(to: string, code: string): Promise<void> {
  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim();
  if (!host || !from) {
    throw new Error(
      "Пошта не налаштована. Додай SMTP_HOST, SMTP_FROM і, якщо сервер просить вхід, SMTP_USER та SMTP_PASS.",
    );
  }
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER?.trim();
  // Gmail shows app passwords in groups of four; spaces are not part of the secret.
  const pass = (process.env.SMTP_PASS ?? "").replace(/\s+/g, "");
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user ? { user, pass } : undefined,
  });
  await transporter.sendMail({
    from,
    to,
    subject: "Royal SASS — код підтвердження",
    text: `Код підтвердження: ${code}\nВін діє 30 хвилин. Якщо ти не реєструвався, проігноруй цей лист.`,
    html: `<p>Код підтвердження:</p><p style="font-size:28px;letter-spacing:0.2em;font-weight:700">${code}</p><p>Він діє 30 хвилин. Якщо ти не реєструвався, проігноруй цей лист.</p>`,
  });
}
