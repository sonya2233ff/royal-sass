import { NextResponse } from "next/server";
import {
  loadConfirmed,
  loadStaplesConfig,
  loadWalmartCatalog,
  PINNED_IDS,
  saveConfirmed,
} from "@/lib/staples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thumbs up → lock preferred productId.
 * Thumbs down → clear confirmation (and optional catalog preferred).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    vote?: "up" | "down";
    productId?: string;
  };

  if (!body.id || !(PINNED_IDS as readonly string[]).includes(body.id)) {
    return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  }
  if (body.vote !== "up" && body.vote !== "down") {
    return NextResponse.json({ ok: false, error: "vote must be up|down" }, { status: 400 });
  }

  const confirmed = await loadConfirmed();
  const cfg = await loadStaplesConfig();
  const catalog = await loadWalmartCatalog();
  const item = cfg.items.find((i) => i.id === body.id);
  const cat = catalog?.items.find((i) => i.id === body.id);

  if (body.vote === "up") {
    const productId =
      body.productId ??
      cat?.offer?.productId ??
      item?.preferredProductId;
    if (!productId) {
      return NextResponse.json(
        { ok: false, error: "no productId to confirm" },
        { status: 400 },
      );
    }
    confirmed[body.id] = {
      productId,
      confirmedAt: new Date().toISOString(),
      label: cat?.offer?.name ?? item?.label,
    };
  } else {
    delete confirmed[body.id];
  }

  await saveConfirmed(confirmed);
  return NextResponse.json({
    ok: true,
    id: body.id,
    vote: body.vote,
    confirmed: confirmed[body.id] ?? null,
  });
}
