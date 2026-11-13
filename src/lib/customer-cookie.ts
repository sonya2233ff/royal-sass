import { cookies } from "next/headers";
import { CUSTOMER_COOKIE } from "@/lib/customer-auth";

const MAX_AGE = 60 * 60 * 24 * 30;

export async function readCustomerToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(CUSTOMER_COOKIE)?.value ?? null;
}

export async function writeCustomerToken(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(CUSTOMER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function clearCustomerToken(): Promise<void> {
  const jar = await cookies();
  jar.set(CUSTOMER_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
