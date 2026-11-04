import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { passwordRuleError } from "@/lib/password-rules";
import { prisma } from "@/lib/prisma";

const scryptAsync = promisify(scrypt);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const CUSTOMER_COOKIE = "royal-sass-customer";

export type CustomerPublic = {
  id: string;
  name: string;
  email: string;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateSignup(input: {
  name: string;
  email: string;
  password: string;
}): { ok: true; name: string; email: string; password: string } | { ok: false; error: string } {
  const name = input.name.trim().slice(0, 40);
  const email = normalizeEmail(input.email);
  if (name.length < 1) return { ok: false, error: "Вкажи ім'я." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Вкажи справжній email." };
  const passwordError = passwordRuleError(input.password);
  if (passwordError) return { ok: false, error: passwordError };
  return { ok: true, name, email, password: input.password };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, 32)) as Buffer;
  return `scrypt:${salt}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, salt, hexHash] = stored.split(":");
  if (kind !== "scrypt" || !salt || !hexHash) return false;
  const hash = (await scryptAsync(password, salt, 32)) as Buffer;
  const expected = Buffer.from(hexHash, "hex");
  if (hash.length !== expected.length) return false;
  return timingSafeEqual(hash, expected);
}

export async function registerCustomer(input: {
  name: string;
  email: string;
  password: string;
}): Promise<{ ok: true; customer: CustomerPublic; token: string } | { ok: false; error: string }> {
  const parsed = validateSignup(input);
  if (!parsed.ok) return parsed;
  const existing = await prisma.customer.findUnique({ where: { email: parsed.email } });
  if (existing) return { ok: false, error: "Такий email уже є. Увійди." };
  const passwordHash = await hashPassword(parsed.password);
  const customer = await prisma.customer.create({
    data: { name: parsed.name, email: parsed.email, passwordHash },
  });
  const token = randomBytes(32).toString("hex");
  await prisma.customerSession.create({
    data: { token, customerId: customer.id },
  });
  return {
    ok: true,
    token,
    customer: { id: customer.id, name: customer.name, email: customer.email },
  };
}

export async function loginCustomer(input: {
  email: string;
  password: string;
}): Promise<{ ok: true; customer: CustomerPublic; token: string } | { ok: false; error: string }> {
  const email = normalizeEmail(input.email);
  const customer = await prisma.customer.findUnique({ where: { email } });
  if (!customer || !(await verifyPassword(input.password, customer.passwordHash))) {
    return { ok: false, error: "Невірний email або пароль." };
  }
  const token = randomBytes(32).toString("hex");
  await prisma.customerSession.create({
    data: { token, customerId: customer.id },
  });
  return {
    ok: true,
    token,
    customer: { id: customer.id, name: customer.name, email: customer.email },
  };
}

export async function customerFromToken(token: string | undefined | null): Promise<CustomerPublic | null> {
  if (!token) return null;
  const session = await prisma.customerSession.findUnique({
    where: { token },
    include: { customer: true },
  });
  if (!session) return null;
  return {
    id: session.customer.id,
    name: session.customer.name,
    email: session.customer.email,
  };
}

export async function revokeToken(token: string | undefined | null): Promise<void> {
  if (!token) return;
  await prisma.customerSession.deleteMany({ where: { token } });
}
