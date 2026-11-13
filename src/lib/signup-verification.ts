import { randomInt } from "node:crypto";
import {
  createCustomerFromHash,
  hashPassword,
  normalizeEmail,
  validateSignup,
  verifyPassword,
  type CustomerPublic,
} from "@/lib/customer-auth";
import { createBusinessWorkspace, validateLocationInput, type LocationInput } from "@/lib/business-location";
import { prisma } from "@/lib/prisma";
import { SIGNUP_CODE_TTL_MS, sendSignupCode } from "@/lib/send-email";

const MAX_ATTEMPTS = 8;

export type SendSignupCode = (email: string, code: string) => Promise<void>;

function newCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function workplaceJson(value: unknown): { ok: true; json: string } | { ok: false; error: string } {
  if (!value || typeof value !== "object") return { ok: false, error: "Обери заклад, щоб створити акаунт." };
  const body = value as { businessType?: string; useAsRouteOrigin?: boolean; location?: LocationInput };
  if (!body.location) return { ok: false, error: "Обери заклад, щоб створити акаунт." };
  const locationError = validateLocationInput(body.location);
  if (locationError) return { ok: false, error: locationError };
  return {
    ok: true,
    json: JSON.stringify({
      businessType: body.businessType,
      useAsRouteOrigin: Boolean(body.useAsRouteOrigin),
      location: body.location,
    }),
  };
}

export async function beginSignup(
  input: { name: string; email: string; password: string; workplace: unknown },
  send: SendSignupCode = sendSignupCode,
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const parsed = validateSignup(input);
  if (!parsed.ok) return parsed;
  const workplace = workplaceJson(input.workplace);
  if (!workplace.ok) return workplace;
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
      workplaceJson: workplace.json,
      expiresAt,
      attempts: 0,
    },
    update: {
      name: parsed.name,
      passwordHash,
      codeHash,
      workplaceJson: workplace.json,
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
  if (!pending.workplaceJson) {
    return { ok: false, error: "Обери заклад, щоб створити акаунт." };
  }
  let workplace: { businessType: string; useAsRouteOrigin: boolean; location: LocationInput };
  try {
    workplace = JSON.parse(pending.workplaceJson) as typeof workplace;
  } catch {
    return { ok: false, error: "Обери заклад, щоб створити акаунт." };
  }
  const created = await createCustomerFromHash({
    name: pending.name,
    email,
    passwordHash: pending.passwordHash,
  });
  if (!created.ok) return created;
  const business = await createBusinessWorkspace(created.customer.id, workplace);
  if (!business.ok) {
    await prisma.customer.delete({ where: { id: created.customer.id } });
    return { ok: false, error: business.error };
  }
  await prisma.signupCode.deleteMany({ where: { email } });
  return created;
}
