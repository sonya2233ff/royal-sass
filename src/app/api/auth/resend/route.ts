import { NextResponse } from "next/server";
import { databaseConfigError, publicDbError } from "@/lib/database-url";
import { resendSignupCode } from "@/lib/signup-verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: string };
  try {
    const unavailable = databaseConfigError();
    if (unavailable) {
      return NextResponse.json({ ok: false, error: unavailable }, { status: 503 });
    }
    const result = await resendSignupCode(String(body.email ?? ""));
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json({ ok: true, email: result.email });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: publicDbError(e) ?? (e instanceof Error ? e.message : "resend failed") },
      { status: 500 },
    );
  }
}
