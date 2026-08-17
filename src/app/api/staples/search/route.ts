import { NextResponse } from "next/server";
import {
  createWalmartConnector,
  walmartSourceApiFields,
} from "@/connectors/walmart-source";
import { NoFrillsConnector } from "@/connectors/nofrills";
import { closeWalmartBrowser } from "@/connectors/walmart-browser";
import type { ProductOffer } from "@/connectors/types";
import {
  isShownStaple,
  loadNoFrillsCatalog,
  loadStaplesConfig,
  loadWalmartCatalog,
} from "@/lib/staples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export type StoreHit = {
  retailer: "walmart_ca" | "no_frills";
  productId: string;
  name: string;
  price: number;
  packageSize?: string;
  sourceUrl?: string;
  image?: string | null;
  onSale?: boolean;
  wasPrice?: number;
  stapleId?: string | null;
};

function parseWalmartProductId(q: string): string | null {
  const url = q.match(
    /walmart\.ca\/(?:en|fr)\/ip\/[^/?#]+\/([A-Za-z0-9]+)/i,
  );
  if (url?.[1]) return url[1];
  const bare = q.trim();
  if (/^[A-Za-z0-9]{8,20}$/.test(bare) && /\d/.test(bare) && /[A-Z]/i.test(bare) === false) {
    return bare;
  }
  if (/^[A-Z0-9]{10,14}$/i.test(bare) && /\d/.test(bare) && /[A-Za-z]/.test(bare)) {
    return bare;
  }
  if (/^\d{6,14}$/.test(bare)) return bare;
  return null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function offerImage(offer: ProductOffer): string | null {
  const raw = asRecord(offer.raw);
  if (!raw) return null;
  const data = asRecord(raw.data) ?? raw;
  for (const c of [
    data.image,
    data.thumbnail,
    Array.isArray(data.images) ? data.images[0] : null,
  ]) {
    if (typeof c === "string" && c.startsWith("http")) return c;
  }
  const imgs = data.productImage ?? data.productImages;
  if (Array.isArray(imgs) && imgs[0]) {
    const first = asRecord(imgs[0]);
    for (const key of ["thumbnailUrl", "smallUrl", "imageUrl"]) {
      const u = first?.[key];
      if (typeof u === "string" && u.startsWith("http")) return u;
    }
  }
  return null;
}

function toHit(
  retailer: StoreHit["retailer"],
  offer: ProductOffer,
  stapleId: string | null,
): StoreHit {
  return {
    retailer,
    productId: offer.productId,
    name: offer.name,
    price: offer.price,
    packageSize: offer.packageSize,
    sourceUrl: offer.sourceUrl,
    image: offerImage(offer),
    onSale: offer.onSale,
    wasPrice: offer.wasPrice,
    stapleId,
  };
}

function hay(s: string): string {
  return s.toLowerCase();
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ ok: true, q, staples: [], walmart: [], noFrills: [] });
  }

  const cfg = await loadStaplesConfig();
  const wmCat = await loadWalmartCatalog();
  const nfCat = await loadNoFrillsCatalog();
  const wmById = new Map(wmCat?.items.map((i) => [i.id, i]) ?? []);
  const nfById = new Map(nfCat?.items.map((i) => [i.id, i]) ?? []);
  const needle = hay(q);

  const staples = cfg.items
    .filter(isShownStaple)
    .map((item) => {
      const wm = wmById.get(item.id)?.offer;
      const nf = nfById.get(item.id)?.offer;
      const blob = hay(
        `${item.label} ${wm?.name ?? ""} ${nf?.name ?? ""} ${item.preferredProductId ?? ""}`,
      );
      return {
        id: item.id,
        label: item.label,
        image: item.image ?? null,
        wmName: wm?.name ?? null,
        nfName: nf?.name ?? null,
        wmPrice: wm?.price ?? null,
        nfPrice: nf?.price ?? null,
        match: blob.includes(needle),
      };
    })
    .filter((s) => s.match)
    .slice(0, 8);

  const wmIdByProduct = new Map<string, string>();
  const nfIdByProduct = new Map<string, string>();
  for (const item of cfg.items.filter(isShownStaple)) {
    const wm = wmById.get(item.id)?.offer?.productId;
    const nf = nfById.get(item.id)?.offer?.productId;
    if (wm) wmIdByProduct.set(wm, item.id);
    if (item.preferredProductId) wmIdByProduct.set(item.preferredProductId, item.id);
    if (nf) nfIdByProduct.set(nf, item.id);
  }

  const wmFields = walmartSourceApiFields();
  let walmartWarning = wmFields.walmartSourceWarning;
  let walmart: StoreHit[] = [];
  let noFrills: StoreHit[] = [];
  try {
    const nf = new NoFrillsConnector();
    const productId = parseWalmartProductId(q);
    const nfHitsP = nf.searchProducts(q, "3660").then((hits) => hits.slice(0, 8));

    let wmHits: ProductOffer[] = [];
    try {
      const wm = createWalmartConnector("L4J0A7");
      const out: ProductOffer[] = [];
      if (productId) {
        try {
          const direct = await wm.getProduct(productId, "5831");
          if (direct) out.push(direct);
        } catch {
          /* search fallback */
        }
      }
      const hits = await wm.searchProducts(productId ?? q, "5831");
      for (const h of hits) {
        if (!out.some((x) => x.productId === h.productId)) out.push(h);
      }
      wmHits = out.slice(0, 8);
    } catch (e) {
      walmartWarning =
        walmartWarning ?? (e instanceof Error ? e.message : String(e));
    }

    const nfHits = await nfHitsP;
    walmart = wmHits.map((o) =>
      toHit("walmart_ca", o, wmIdByProduct.get(o.productId) ?? null),
    );
    noFrills = nfHits.map((o) =>
      toHit("no_frills", o, nfIdByProduct.get(o.productId) ?? null),
    );
  } finally {
    await closeWalmartBrowser().catch(() => undefined);
  }

  return NextResponse.json({
    ok: true,
    q,
    staples,
    walmart,
    noFrills,
    ...wmFields,
    walmartSourceWarning: walmartWarning,
  });
}
