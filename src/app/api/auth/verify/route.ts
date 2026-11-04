import { NextResponse } from "next/server";
import { writeCustomerToken } from "@/lib/customer-cookie";
import { confirmSignupCode } from "@/lib/signup-verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    email?: string;
    code?: string;
  };
  try {
    const result = await confirmSignupCode({
      email: String(body.email ?? ""),
      code: String(body.code ?? ""),
    });
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    await writeCustomerToken(result.token);
    return NextResponse.json({ ok: true, customer: result.customer });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "verify failed" },
      { status: 500 },
    );
  }
}
