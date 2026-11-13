import { NextResponse } from "next/server";
import { resendSignupCode } from "@/lib/signup-verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: string };
  try {
    const result = await resendSignupCode(String(body.email ?? ""));
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json({ ok: true, email: result.email });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "resend failed" },
      { status: 500 },
    );
  }
}
