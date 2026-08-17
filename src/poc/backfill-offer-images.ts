/**
 * Fetch each catalog SKU's own photo (Rapid / PCX getProduct).
 * Does not rematch staples or change prices.
 *
 *   npx tsx --env-file=.env src/poc/backfill-offer-images.ts
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProductOffer } from "@/connectors/types";
import { NoFrillsConnector } from "@/connectors/nofrills";
import { WalmartRapidConnector } from "@/connectors/walmart-rapid";
import { extractRetailerImage, isHttpImageUrl } from "@/lib/product-image";
import {
  PINNED_IDS,
  loadNoFrillsCatalog,
  loadWalmartCatalog,
} from "@/lib/staples";

const OUT = path.join(process.cwd(), "config", "retailer-offer-images.json");
const WM_STORE = "5831";
const NF_STORE = "3660";

type ImageMap = {
  walmart_ca: Record<string, string>;
  no_frills: Record<string, string>;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function put(map: Record<string, string>, productId: string, url: string) {
  map[productId] = url;
  const stripped = productId.replace(/_(EA|KG|LB|C\d+)$/i, "");
  if (stripped && stripped !== productId) map[stripped] = url;
}

function collectIds(
  items: Array<{
    id?: string;
    offer?: { productId?: string; image?: string; sourceUrl?: string } | null;
    alternates?: Array<{
      productId?: string;
      image?: string;
      sourceUrl?: string;
    }> | null;
  }>,
): Map<string, { image?: string; aliases: string[] }> {
  const out = new Map<string, { image?: string; aliases: string[] }>();
  const pinned = new Set<string>(PINNED_IDS);
  for (const row of items) {
    if (row.id && !pinned.has(row.id)) continue;
    const offers = [row.offer, ...(row.alternates ?? [])];
    for (const offer of offers) {
      if (!offer?.productId) continue;
      const aliases: string[] = [];
      const urlId = offer.sourceUrl?.match(/\/(\d{6,})(?:\?|$)/)?.[1];
      if (urlId && urlId !== offer.productId) aliases.push(urlId);
      const prev = out.get(offer.productId);
      out.set(offer.productId, {
        image: offer.image ?? prev?.image,
        aliases: [...new Set([...(prev?.aliases ?? []), ...aliases])],
      });
    }
  }
  return out;
}

function imageFromOffer(offer?: ProductOffer | null): string | undefined {
  if (!offer) return undefined;
  return (isHttpImageUrl(offer.image) ? offer.image : undefined) ??
    extractRetailerImage(offer.raw);
}

async function loadExisting(): Promise<ImageMap> {
  try {
    const raw = JSON.parse(await readFile(OUT, "utf8")) as Partial<ImageMap>;
    return {
      walmart_ca: { ...(raw.walmart_ca ?? {}) },
      no_frills: { ...(raw.no_frills ?? {}) },
    };
  } catch {
    return { walmart_ca: {}, no_frills: {} };
  }
}

async function main() {
  const wmCat = await loadWalmartCatalog();
  const nfCat = await loadNoFrillsCatalog();
  const map = await loadExisting();

  const wmIds = collectIds(wmCat?.items ?? []);
  const nfIds = collectIds(nfCat?.items ?? []);

  for (const [id, meta] of wmIds) {
    if (isHttpImageUrl(meta.image)) put(map.walmart_ca, id, meta.image.trim());
  }
  for (const [id, meta] of nfIds) {
    if (isHttpImageUrl(meta.image)) put(map.no_frills, id, meta.image.trim());
  }

  const wm = new WalmartRapidConnector();
  const nf = new NoFrillsConnector();

  let wmOk = 0;
  let wmFail = 0;
  for (const [productId, meta] of wmIds) {
    if (map.walmart_ca[productId]) {
      wmOk += 1;
      continue;
    }
    const tryIds = [productId, ...meta.aliases];
    let url: string | undefined;
    try {
      for (const id of tryIds) {
        try {
          url = imageFromOffer(await wm.getProduct(id, WM_STORE));
          if (url) break;
        } catch {
          /* product-details often 400s on catalog us-item ids */
        }
      }
      if (!url) {
        const hits = await wm.searchProducts(productId, WM_STORE);
        const hit =
          hits.find((h) => h.productId === productId) ??
          hits.find((h) => tryIds.includes(h.productId));
        url = imageFromOffer(hit);
      }
      if (url) {
        put(map.walmart_ca, productId, url);
        for (const alias of meta.aliases) put(map.walmart_ca, alias, url);
        wmOk += 1;
        console.log(`WM ok  ${productId}`);
      } else {
        wmFail += 1;
        console.log(`WM miss ${productId}`);
      }
    } catch (e) {
      wmFail += 1;
      console.log(
        `WM err  ${productId} ${(e instanceof Error ? e.message : e).toString().slice(0, 80)}`,
      );
    }
    await sleep(350);
  }

  let nfOk = 0;
  let nfFail = 0;
  for (const productId of nfIds.keys()) {
    if (map.no_frills[productId]) {
      nfOk += 1;
      continue;
    }
    try {
      const live = await nf.getProduct(productId, NF_STORE);
      const url =
        (live && isHttpImageUrl(live.image) ? live.image : undefined) ??
        extractRetailerImage(live?.raw);
      if (url) {
        put(map.no_frills, productId, url);
        nfOk += 1;
        console.log(`NF ok  ${productId}`);
      } else {
        nfFail += 1;
        console.log(`NF miss ${productId}`);
      }
    } catch (e) {
      nfFail += 1;
      console.log(
        `NF err  ${productId} ${(e instanceof Error ? e.message : e).toString().slice(0, 80)}`,
      );
    }
    await sleep(300);
  }

  await writeFile(OUT, `${JSON.stringify(map, null, 2)}\n`, "utf8");
  console.log(
    `wrote ${OUT} wm=${wmOk}/${wmIds.size} nf=${nfOk}/${nfIds.size} wmFail=${wmFail} nfFail=${nfFail}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
