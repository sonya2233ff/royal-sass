import { NextResponse } from "next/server";
import { createWalmartConnector } from "@/connectors/create-walmart-connector";
import { walmartSourceApiFields } from "@/connectors/walmart-source";
import { NoFrillsConnector } from "@/connectors/nofrills";
import { WholesaleClubConnector } from "@/connectors/wholesaleclub";
import { MvrConnector } from "@/connectors/mvr";
import { closeWalmartBrowser } from "@/connectors/walmart-browser";
import type { ProductOffer } from "@/connectors/types";
import { offerImageUrl } from "@/lib/product-image";
import {
  isShownStaple,
  isEggPackItem,
  loadNoFrillsCatalog,
  loadStaplesConfig,
  loadWalmartCatalog,
} from "@/lib/staples";
import { loadWholesaleClubCatalog } from "@/lib/wholesaleclub-catalog";
import { loadMvrCatalog } from "@/lib/mvr-catalog";
import {
  categoryBSearchQueries,
  isCategoryBStaple,
  nameMatchesFilterPhrase,
  warehouseTitleView,
} from "@/domain/catalog-normalize";
import {
  englishEggSearchQueries,
  isEggPackStaple,
  queryLooksLikeShellEggs,
} from "@/domain/egg-pack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export type StoreHit = {
  retailer: "walmart_ca" | "no_frills" | "wholesale_club" | "mvr";
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
    image: offerImageUrl(offer) ?? null,
    onSale: offer.onSale,
    wasPrice: offer.wasPrice,
    stapleId,
  };
}

function hay(s: string): string {
  return warehouseTitleView(s).toLowerCase();
}

function textMatchesQuery(query: string, ...parts: Array<string | undefined>): boolean {
  const haystack = hay(parts.filter(Boolean).join(" "));
  const needle = query.trim().toLowerCase();
  if (!needle || !haystack) return false;
  if (haystack.includes(needle)) return true;
  return nameMatchesFilterPhrase(haystack, needle, true);
}

function uniqueQueries(queries: string[], limit: number): string[] {
  const out: string[] = [];
  for (const q of queries) {
    const t = q.replace(/\s+/g, " ").trim();
    if (t.length < 2) continue;
    if (out.some((x) => x.toLowerCase() === t.toLowerCase())) continue;
    out.push(t);
  }
  return out.slice(0, limit);
}

function liveSearchQueries(
  q: string,
  staples: Array<{
    category?: string;
    queries: string[];
    mustIncludeAny?: string[];
    label?: string;
  }>,
): string[] {
  const parts = q.split(/\s+/).filter(Boolean);
  const extra: string[] = [q, ...englishEggSearchQueries(q)];
  if (parts.length === 2) extra.push(`${parts[1]} ${parts[0]}`);
  extra.push(q.replace(/\bfresh\b/gi, " "));
  for (const item of staples) {
    if (!isCategoryBStaple(item) && !isEggPackStaple(item)) continue;
    if (
      !queryLooksLikeShellEggs(q) &&
      !textMatchesQuery(q, item.label, ...(item.queries ?? []), ...(item.mustIncludeAny ?? []))
    ) {
      continue;
    }
    if (isEggPackStaple(item) && queryLooksLikeShellEggs(q)) {
      extra.push(...(item.queries ?? []).slice(0, 3));
      continue;
    }
    extra.push(...categoryBSearchQueries(item, 4));
  }
  return uniqueQueries(extra, 8);
}

type CatalogRow = {
  id?: string;
  offer?: {
    productId?: string;
    name?: string;
    price?: number;
    packageSize?: string;
    sourceUrl?: string;
    image?: string | null;
    onSale?: boolean;
    wasPrice?: number;
  } | null;
  alternates?: Array<{
    productId?: string;
    name?: string;
    price?: number;
    packageSize?: string;
    sourceUrl?: string;
    image?: string | null;
    onSale?: boolean;
    wasPrice?: number;
  } | null>;
};

function catalogOfferMatchesNeedles(
  offer: { name?: string; packageSize?: string } | null | undefined,
  needles: string[],
): boolean {
  if (!offer?.name) return false;
  const blob = `${offer.name} ${offer.packageSize ?? ""}`.toLowerCase();
  return needles.some((n) => n.length >= 2 && blob.includes(n));
}

function hitsFromCatalogRow(
  retailer: StoreHit["retailer"],
  row: CatalogRow | undefined,
  needles: string[],
  stapleId: string,
): StoreHit[] {
  if (!row) return [];
  const out: StoreHit[] = [];
  for (const offer of [row.offer, ...(row.alternates ?? [])]) {
    if (!offer?.productId || !offer.name || !(offer.price! > 0)) continue;
    if (!catalogOfferMatchesNeedles(offer, needles)) continue;
    out.push({
      retailer,
      productId: offer.productId,
      name: offer.name,
      price: offer.price!,
      packageSize: offer.packageSize,
      sourceUrl: offer.sourceUrl,
      image: offer.image ?? null,
      onSale: offer.onSale,
      wasPrice: offer.wasPrice,
      stapleId,
    });
  }
  return out;
}

function mergeHits(preferred: StoreHit[], extra: StoreHit[], limit: number): StoreHit[] {
  const seen = new Set<string>();
  const out: StoreHit[] = [];
  for (const hit of [...preferred, ...extra]) {
    const key = `${hit.retailer}:${hit.productId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}

async function mergeSearch(
  search: (q: string) => Promise<ProductOffer[]>,
  queries: string[],
  limit: number,
  keep?: (o: ProductOffer) => boolean,
): Promise<ProductOffer[]> {
  const seen = new Map<string, ProductOffer>();
  for (const q of queries) {
    try {
      const hits = await search(q);
      for (const h of hits) {
        if (!h?.productId || seen.has(h.productId)) continue;
        if (keep && !keep(h)) continue;
        seen.set(h.productId, h);
      }
    } catch {
      /* next query */
    }
  }
  return [...seen.values()].slice(0, limit);
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({
      ok: true,
      q,
      staples: [],
      walmart: [],
      noFrills: [],
      wholesaleClub: [],
      mvr: [],
    });
  }

  const cfg = await loadStaplesConfig();
  const wmCat = await loadWalmartCatalog();
  const nfCat = await loadNoFrillsCatalog();
  const wcCat = await loadWholesaleClubCatalog();
  const mvrCat = await loadMvrCatalog();
  const wmById = new Map(wmCat?.items.map((i) => [i.id, i]) ?? []);
  const nfById = new Map(nfCat?.items.map((i) => [i.id, i]) ?? []);
  const wcById = new Map(wcCat?.items.map((i) => [i.id, i]) ?? []);
  const mvrById = new Map(mvrCat?.items.map((i) => [i.id, i]) ?? []);
  const liveQueries = liveSearchQueries(q, cfg.items.filter(isShownStaple));
  const eggQuery = queryLooksLikeShellEggs(q);
  const catalogNeedles = uniqueQueries(
    eggQuery ? [q, ...englishEggSearchQueries(q)] : [q],
    8,
  );

  const staples = cfg.items
    .filter(isShownStaple)
    .map((item) => {
      const wm = wmById.get(item.id)?.offer;
      const nf = nfById.get(item.id)?.offer;
      const wc = wcById.get(item.id)?.offer;
      const mvr = mvrById.get(item.id)?.offer;
      const eggHit = eggQuery && isEggPackStaple(item);
      const match =
        eggHit ||
        textMatchesQuery(
          q,
          item.label,
          item.id.replace(/_/g, " "),
          ...(item.queries ?? []),
          ...(item.mustIncludeAny ?? []),
          wm?.name,
          nf?.name,
          wc?.name,
          mvr?.name,
          wm?.taxonomyText,
          nf?.taxonomyText,
          wc?.taxonomyText,
          mvr?.taxonomyText,
          item.preferredProductId,
        );
      return {
        id: item.id,
        label: item.label,
        image: item.image ?? null,
        wmName: wm?.name ?? null,
        nfName: nf?.name ?? null,
        wcName: wc?.name ?? null,
        mvrName: mvr?.name ?? null,
        wmPrice: wm?.price ?? null,
        nfPrice: nf?.price ?? null,
        wcPrice: wc?.price ?? null,
        mvrPrice: mvr?.price ?? null,
        match,
      };
    })
    .filter((s) => s.match)
    .sort((a, b) => {
      if (!eggQuery) return 0;
      return Number(isEggPackStaple(b)) - Number(isEggPackStaple(a));
    })
    .slice(0, 8);

  const catalogHits: StoreHit[] = [];
  if (eggQuery) {
    for (const item of cfg.items.filter(isShownStaple)) {
      if (!isEggPackItem(item)) continue;
      catalogHits.push(
        ...hitsFromCatalogRow("walmart_ca", wmById.get(item.id), catalogNeedles, item.id),
        ...hitsFromCatalogRow("no_frills", nfById.get(item.id), catalogNeedles, item.id),
        ...hitsFromCatalogRow("wholesale_club", wcById.get(item.id), catalogNeedles, item.id),
        ...hitsFromCatalogRow("mvr", mvrById.get(item.id), catalogNeedles, item.id),
      );
    }
  }

  const wmIdByProduct = new Map<string, string>();
  const nfIdByProduct = new Map<string, string>();
  const wcIdByProduct = new Map<string, string>();
  const mvrIdByProduct = new Map<string, string>();
  for (const item of cfg.items.filter(isShownStaple)) {
    const wmRow = wmById.get(item.id);
    const nfRow = nfById.get(item.id);
    const wcRow = wcById.get(item.id);
    const mvrRow = mvrById.get(item.id);
    const bind = (
      map: Map<string, string>,
      row?: { offer?: { productId?: string } | null; alternates?: Array<{ productId?: string } | null> },
    ) => {
      if (row?.offer?.productId) map.set(row.offer.productId, item.id);
      for (const alt of row?.alternates ?? []) {
        if (alt?.productId) map.set(alt.productId, item.id);
      }
    };
    bind(wmIdByProduct, wmRow);
    if (item.preferredProductId) wmIdByProduct.set(item.preferredProductId, item.id);
    bind(nfIdByProduct, nfRow);
    bind(wcIdByProduct, wcRow);
    bind(mvrIdByProduct, mvrRow);
  }

  const wmFields = walmartSourceApiFields();
  let walmartWarning = wmFields.walmartSourceWarning;
  let walmart: StoreHit[] = [];
  let noFrills: StoreHit[] = [];
  let wholesaleClub: StoreHit[] = [];
  let mvr: StoreHit[] = [];
  try {
    const nf = new NoFrillsConnector();
    const wc = new WholesaleClubConnector();
    const mvrConn = new MvrConnector();
    const productId = parseWalmartProductId(q);
    const nfHitsP = mergeSearch(
      (query) => nf.searchProducts(query, "3660"),
      liveQueries,
      8,
    );
    const wcHitsP = mergeSearch(
      (query) => wc.searchProducts(query, "3724"),
      liveQueries,
      8,
      (h) => !/_C\d+$/i.test(h.productId),
    );
    const mvrHitsP = mergeSearch(
      (query) => mvrConn.searchProducts(query, "weston"),
      liveQueries,
      8,
    );

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

    const [nfHits, wcHits, mvrHits] = await Promise.all([
      nfHitsP,
      wcHitsP,
      mvrHitsP,
    ]);
    walmart = mergeHits(
      catalogHits.filter((h) => h.retailer === "walmart_ca"),
      wmHits.map((o) =>
        toHit("walmart_ca", o, wmIdByProduct.get(o.productId) ?? null),
      ),
      8,
    );
    noFrills = mergeHits(
      catalogHits.filter((h) => h.retailer === "no_frills"),
      nfHits.map((o) =>
        toHit("no_frills", o, nfIdByProduct.get(o.productId) ?? null),
      ),
      8,
    );
    wholesaleClub = mergeHits(
      catalogHits.filter((h) => h.retailer === "wholesale_club"),
      wcHits.map((o) =>
        toHit("wholesale_club", o, wcIdByProduct.get(o.productId) ?? null),
      ),
      8,
    );
    mvr = mergeHits(
      catalogHits.filter((h) => h.retailer === "mvr"),
      mvrHits.map((o) =>
        toHit("mvr", o, mvrIdByProduct.get(o.productId) ?? null),
      ),
      8,
    );
  } finally {
    await closeWalmartBrowser().catch(() => undefined);
  }

  if (eggQuery) {
    walmart = mergeHits(
      catalogHits.filter((h) => h.retailer === "walmart_ca"),
      walmart,
      8,
    );
    noFrills = mergeHits(
      catalogHits.filter((h) => h.retailer === "no_frills"),
      noFrills,
      8,
    );
    wholesaleClub = mergeHits(
      catalogHits.filter((h) => h.retailer === "wholesale_club"),
      wholesaleClub,
      8,
    );
    mvr = mergeHits(
      catalogHits.filter((h) => h.retailer === "mvr"),
      mvr,
      8,
    );
  }

  return NextResponse.json({
    ok: true,
    q,
    staples,
    walmart,
    noFrills,
    wholesaleClub,
    mvr,
    ...wmFields,
    walmartSourceWarning: walmartWarning,
  });
}
