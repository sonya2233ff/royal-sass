import { NextResponse } from "next/server";
import { createWalmartConnector } from "@/connectors/create-walmart-connector";
import { closeWalmartBrowser } from "@/connectors/walmart-browser";
import { parseMassFromText } from "@/domain/units";
import {
  isShownStaple,
  loadNoFrillsCatalog,
  loadStaplesConfig,
  loadWalmartCatalog,
  saveCustomStaple,
  searchNoFrills,
  upsertNoFrillsCatalogItem,
  upsertWalmartCatalogItem,
  type StapleItem,
} from "@/lib/staples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = {
  retailer?: "walmart_ca" | "no_frills";
  productId?: string;
  name?: string;
  price?: number;
  packageSize?: string;
  sourceUrl?: string;
  image?: string | null;
  wasPrice?: number;
  onSale?: boolean;
};

function slugId(name: string, productId: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 28);
  const tail = productId.replace(/[^a-z0-9]/gi, "").slice(-8);
  return `custom_${slug || "item"}_${tail || "x"}`;
}

function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4)
    .slice(0, 4);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  const productId = String(body.productId ?? "").trim();
  const name = String(body.name ?? "").trim();
  const price = Number(body.price);
  const retailer = body.retailer === "no_frills" ? "no_frills" : "walmart_ca";
  if (!productId || !name || !(price > 0)) {
    return NextResponse.json(
      { ok: false, error: "productId, name, price required" },
      { status: 400 },
    );
  }

  const cfg = await loadStaplesConfig();
  const wmCat = await loadWalmartCatalog();
  const nfCat = await loadNoFrillsCatalog();
  const existing = cfg.items.filter(isShownStaple).find((item) => {
    if (item.preferredProductId === productId) return true;
    const wm = wmCat?.items.find((r) => r.id === item.id)?.offer;
    const nf = nfCat?.items.find((r) => r.id === item.id)?.offer;
    return wm?.productId === productId || nf?.productId === productId;
  });
  if (existing) {
    return NextResponse.json({ ok: true, id: existing.id, existed: true });
  }

  const id = slugId(name, productId);
  const item: StapleItem = {
    id,
    label: name.replace(/\s+/g, " ").slice(0, 80),
    queries: [name],
    mustIncludeAny: tokens(name).slice(0, 2),
    preferredProductId: retailer === "walmart_ca" ? productId : undefined,
    minPlausiblePrice: Math.max(0.5, Math.round(price * 0.4 * 100) / 100),
    maxPlausiblePrice: Math.round(price * 2.5 * 100) / 100,
    image: body.image ?? undefined,
    notes: `Added from search (${retailer} ${productId})`,
    custom: true,
  };
  await saveCustomStaple(item);

  const mass =
    parseMassFromText(body.packageSize ?? "") ?? parseMassFromText(name);
  const offer = {
    productId,
    name,
    price,
    packageSize: body.packageSize,
    parsedMassKg: mass?.kg,
    wasPrice: body.wasPrice,
    onSale: body.onSale,
    confidence: "exact" as const,
    checkedAt: new Date().toISOString(),
    sourceUrl: body.sourceUrl,
    image: body.image ?? undefined,
  };

  if (retailer === "walmart_ca") {
    await upsertWalmartCatalogItem({
      id,
      label: item.label,
      status: "ok",
      offer,
      image: item.image,
      notes: "Adopted from search",
    });
    try {
      const log = {
        at: new Date().toISOString(),
        itemId: id,
        retailer: "no_frills" as const,
        queries: [],
        rejected: [] as Array<{ reason: string }>,
        status: "no_match" as const,
      };
      const nfOffer = await searchNoFrills(item, log);
      if (nfOffer) {
        const nfMass =
          parseMassFromText(nfOffer.packageSize ?? "") ??
          parseMassFromText(nfOffer.name);
        await upsertNoFrillsCatalogItem({
          id,
          label: item.label,
          status: log.status,
          offer: {
            productId: nfOffer.productId,
            name: nfOffer.name,
            price: nfOffer.price,
            packageSize: nfOffer.packageSize,
            parsedMassKg: nfMass?.kg,
            unitPrice: nfOffer.unitPrice,
            wasPrice: nfOffer.wasPrice,
            onSale: nfOffer.onSale,
            confidence: nfOffer.confidence,
            checkedAt: nfOffer.checkedAt,
            sourceUrl: nfOffer.sourceUrl,
            image: nfOffer.image,
          },
          notes: "Matched from search adopt",
        });
      } else {
        await upsertNoFrillsCatalogItem({
          id,
          label: item.label,
          status: "no_match",
          offer: null,
          notes: log.rejected.at(-1)?.reason,
        });
      }
    } catch {
      /* NF optional */
    }
  } else {
    await upsertNoFrillsCatalogItem({
      id,
      label: item.label,
      status: "ok",
      offer,
      notes: "Adopted from search",
    });
    try {
      const wm = createWalmartConnector("L4J0A7");
      const hits = await wm.searchProducts(name, "5831");
      const best =
        hits.find((h) => h.productId === item.preferredProductId) ?? hits[0];
      if (best) {
        const wmMass =
          parseMassFromText(best.packageSize ?? "") ?? parseMassFromText(best.name);
        await upsertWalmartCatalogItem({
          id,
          label: item.label,
          status: "ok",
          offer: {
            productId: best.productId,
            name: best.name,
            price: best.price,
            packageSize: best.packageSize,
            parsedMassKg: wmMass?.kg,
            wasPrice: best.wasPrice,
            onSale: best.onSale,
            confidence: best.confidence,
            checkedAt: best.checkedAt,
            sourceUrl: best.sourceUrl,
            image: best.image,
          },
          image: item.image,
          notes: "WM match from NF adopt",
        });
      }
    } catch {
      /* WM optional */
    } finally {
      await closeWalmartBrowser().catch(() => undefined);
    }
  }

  return NextResponse.json({ ok: true, id, existed: false });
}
