import { NextResponse } from "next/server";
import { requireCustomer } from "@/lib/business-access";
import { autocompletePlaces } from "@/lib/google-places";
import { allowRate } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function callerKey(request: Request, customerId: string | null): string {
  if (customerId) return customerId;
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "guest";
}

export async function POST(request: Request) {
  const customer = await requireCustomer();
  if (!allowRate(`places:${callerKey(request, customer?.id ?? null)}`, customer ? 30 : 12, 60_000)) {
    return NextResponse.json({ ok: false, error: "Забагато пошуків. Зачекай хвилину." }, { status: 429 });
  }
  const body = (await request.json().catch(() => ({}))) as { input?: string; sessionToken?: string };
  const sessionToken = String(body.sessionToken ?? "");
  if (!UUID.test(sessionToken)) {
    return NextResponse.json({ ok: false, error: "Пошук адреси треба почати спочатку." }, { status: 400 });
  }
  const result = await autocompletePlaces(String(body.input ?? ""), sessionToken);
  if (!result.ok) {
    const status = result.code === "not_configured" || result.code === "provider_failed" ? 503 : result.code === "quota" ? 429 : 400;
    return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status });
  }
  return NextResponse.json({ ok: true, suggestions: result.data });
}
