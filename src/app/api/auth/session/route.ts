import { NextResponse } from "next/server";
import { customerFromToken } from "@/lib/customer-auth";
import { readCustomerToken } from "@/lib/customer-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const customer = await customerFromToken(await readCustomerToken());
  return NextResponse.json({ ok: true, customer });
}
