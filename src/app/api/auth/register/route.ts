import { NextResponse } from "next/server";
import { databaseConfigError, publicDbError } from "@/lib/database-url";
import { passwordConfirmError } from "@/lib/password-rules";
import { beginSignup } from "@/lib/signup-verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start signup: store a pending row and email a 30-minute code. Does not sign in. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
    workplace?: unknown;
  };
  try {
    const unavailable = databaseConfigError();
    if (unavailable) {
      return NextResponse.json({ ok: false, error: unavailable }, { status: 503 });
    }
    const password = String(body.password ?? "");
    const mismatch = passwordConfirmError(password, String(body.confirmPassword ?? ""));
    if (mismatch) {
      return NextResponse.json({ ok: false, error: mismatch }, { status: 400 });
    }
    const result = await beginSignup({
      name: String(body.name ?? ""),
      email: String(body.email ?? ""),
      password,
      workplace: body.workplace,
    });
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json({ ok: true, pending: true, email: result.email });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: publicDbError(e) ?? (e instanceof Error ? e.message : "register failed") },
      { status: 500 },
    );
  }
}
