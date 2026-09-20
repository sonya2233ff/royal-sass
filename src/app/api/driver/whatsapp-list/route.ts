import { NextResponse } from "next/server";
import { catalogSearchHay } from "@/domain/staple-search";
import { toRestaurantProduct } from "@/domain/restaurant-product";
import {
  applyWhatsAppAiHint,
  parseWhatsAppList,
  type WhatsAppCatalogItem,
} from "@/domain/whatsapp-list";
import { parseCustomStapleDrafts } from "@/lib/product-config";
import { isSoldByWeightItem, loadStaplesConfig, shownStaples } from "@/lib/staples";
import { mapWhatsAppLinesWithAi } from "@/lib/whatsapp-list-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Parse a pasted WhatsApp shopping list onto shown Master Products only. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    text?: unknown;
    customStaples?: unknown;
  };
  const text = String(body.text ?? "").trim();
  if (!text) {
    return NextResponse.json(
      { ok: false, error: "paste a shopping list" },
      { status: 400 },
    );
  }

  const extra = parseCustomStapleDrafts(body.customStaples);
  const cfg = await loadStaplesConfig(extra);
  const shown = await shownStaples(cfg.items);
  const catalog: WhatsAppCatalogItem[] = shown.map((item) => {
    const product = toRestaurantProduct({
      ...item,
      soldByWeight: isSoldByWeightItem(item),
    });
    return {
      id: item.id,
      label: item.label,
      queries: item.queries,
      mustIncludeAny: item.mustIncludeAny,
      mustIncludeAll: item.mustIncludeAll,
      searchHay: catalogSearchHay(item),
      unit: product.unit,
      defaultAmount: product.defaultAmount,
      soldByWeight: isSoldByWeightItem(item),
      category: item.category,
    };
  });

  const parsed = parseWhatsAppList(text, catalog);
  const needsAi = parsed.decisions.filter(
    (row) => row.status !== "matched",
  );
  let usedAi = false;
  if (needsAi.length) {
    try {
      const hints = await mapWhatsAppLinesWithAi(
        needsAi.map((row) => ({ query: row.query, raw: row.raw })),
        catalog,
      );
      if (hints.length) {
        usedAi = true;
        const byQuery = new Map(
          hints.map((h) => [h.query.toLowerCase(), h] as const),
        );
        parsed.decisions = parsed.decisions.map((row) => {
          if (row.status === "matched") return row;
          const hint =
            byQuery.get(row.query.toLowerCase()) ??
            hints.find(
              (h) =>
                h.query.toLowerCase() === row.raw.toLowerCase() ||
                h.query.toLowerCase() === row.query.toLowerCase(),
            );
          if (!hint) return row;
          return applyWhatsAppAiHint(
            row,
            hint.productId,
            catalog,
            hint.confidence,
          );
        });
      }
    } catch {
      /* local catalog match still applies */
    }
  }

  return NextResponse.json({
    ok: true,
    usedAi,
    decisions: parsed.decisions,
    skipped: parsed.skipped,
  });
}
