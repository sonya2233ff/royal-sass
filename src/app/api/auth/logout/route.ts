import { NextResponse } from "next/server";
import { revokeToken } from "@/lib/customer-auth";
import { clearCustomerToken, readCustomerToken } from "@/lib/customer-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const token = await readCustomerToken();
  await revokeToken(token);
  await clearCustomerToken();
  return NextResponse.json({ ok: true });
}
