import { NextResponse } from "next/server";
import { registerCustomer } from "@/lib/customer-auth";
import { writeCustomerToken } from "@/lib/customer-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    email?: string;
    password?: string;
  };
  try {
    const result = await registerCustomer({
      name: String(body.name ?? ""),
      email: String(body.email ?? ""),
      password: String(body.password ?? ""),
    });
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    await writeCustomerToken(result.token);
    return NextResponse.json(
      { ok: true, customer: result.customer },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "register failed" },
      { status: 500 },
    );
  }
}
