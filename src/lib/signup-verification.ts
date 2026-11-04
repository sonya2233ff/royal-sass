import { randomInt } from "node:crypto";
import {
  createCustomerFromHash,
  hashPassword,
  normalizeEmail,
  validateSignup,
  verifyPassword,
  type CustomerPublic,
} from "@/lib/customer-auth";
import { prisma } from "@/lib/prisma";
import { SIGNUP_CODE_TTL_MS, sendSignupCode } from "@/lib/send-email";

const MAX_ATTEMPTS = 8;

export type SendSignupCode = (email: string, code: string) => Promise<void>;

function newCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export async function beginSignup(
  input: { name: string; email: string; password: string },
  send: SendSignupCode = sendSignupCode,
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const parsed = validateSignup(input);
  if (!parsed.ok) return parsed;
  const existing = await prisma.customer.findUnique({ where: { email: parsed.email } });
  if (existing) return { ok: false, error: "Такий email уже є. Увійди." };

  const code = newCode();
  const [codeHash, passwordHash] = await Promise.all([
    hashPassword(code),
    hashPassword(parsed.password),
  ]);
  const expiresAt = new Date(Date.now() + SIGNUP_CODE_TTL_MS);
  await prisma.signupCode.upsert({
    where: { email: parsed.email },
    create: {
      email: parsed.email,
      name: parsed.name,
      passwordHash,
      codeHash,
      expiresAt,
      attempts: 0,
    },
    update: {
      name: parsed.name,
      passwordHash,
      codeHash,
      expiresAt,
      attempts: 0,
    },
  });
  try {
    await send(parsed.email, code);
  } catch (e) {
    await prisma.signupCode.deleteMany({ where: { email: parsed.email } });
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Не вдалося надіслати лист.",
    };
  }
  return { ok: true, email: parsed.email };
}

export async function resendSignupCode(
  emailRaw: string,
  send: SendSignupCode = sendSignupCode,
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const email = normalizeEmail(emailRaw);
  const pending = await prisma.signupCode.findUnique({ where: { email } });
  if (!pending) {
    return { ok: false, error: "Немає активного коду. Заповни реєстрацію ще раз." };
  }
  const code = newCode();
  const codeHash = await hashPassword(code);
  const expiresAt = new Date(Date.now() + SIGNUP_CODE_TTL_MS);
  try {
    await send(email, code);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Не вдалося надіслати лист.",
    };
  }
  await prisma.signupCode.update({
    where: { email },
    data: { codeHash, expiresAt, attempts: 0 },
  });
  return { ok: true, email };
}

export async function confirmSignupCode(input: {
  email: string;
  code: string;
}): Promise<{ ok: true; customer: CustomerPublic; token: string } | { ok: false; error: string }> {
  const email = normalizeEmail(input.email);
  const code = input.code.trim();
  const pending = await prisma.signupCode.findUnique({ where: { email } });
  if (!pending) {
    return { ok: false, error: "Немає активного коду. Заповни реєстрацію ще раз." };
  }
  if (pending.expiresAt.getTime() < Date.now()) {
    await prisma.signupCode.delete({ where: { email } });
    return { ok: false, error: "Код діяв 30 хвилин і вже прострочений. Надішли новий." };
  }
  if (pending.attempts >= MAX_ATTEMPTS) {
    return { ok: false, error: "Забагато спроб. Надішли код ще раз." };
  }
  const match = await verifyPassword(code, pending.codeHash);
  if (!match) {
    await prisma.signupCode.update({
      where: { email },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, error: "Невірний код." };
  }
  const created = await createCustomerFromHash({
    name: pending.name,
    email,
    passwordHash: pending.passwordHash,
  });
  await prisma.signupCode.deleteMany({ where: { email } });
  return created;
}
