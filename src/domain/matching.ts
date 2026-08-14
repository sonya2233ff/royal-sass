import type { ProductOffer } from "@/connectors/types";
import { scoreMassMatch, resolveUnitPrices } from "@/domain/units";

const STOP = new Set([
  "the",
  "and",
  "or",
  "a",
  "an",
  "of",
  "for",
  "with",
  "pack",
  "pk",
  "size",
  "bunch",
]);

/** Size / unit tokens are soft preferences, not hard requirements. */
const SOFT = new Set([
  "4l",
  "3l",
  "2l",
  "1l",
  "4",
  "3",
  "2",
  "1",
  "l",
  "kg",
  "g",
  "ml",
  "dozen",
  "12",
  "ea",
  "each",
  "1kg",
  "500g",
  "1000g",
]);

const REJECT_IF_PRESENT = [
  "pump",
  "dessert",
  "dog",
  "cat",
  "treat",
  "shampoo",
  "toy",
  "potter",
  "dragon",
  "harry",
  "medela",
  "norbert",
  "hagrid",
  "easter",
  "fillable",
  "party",
  "powder",
  "chocolate",
];

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/%/g, " percent ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOP.has(t));
}

function tokenHit(needle: string, hay: string[]): boolean {
  return hay.some(
    (n) =>
      n === needle ||
      (needle.length >= 4 && (n.startsWith(needle) || needle.startsWith(n))),
  );
}

/** Score how well an offer matches the intended grocery query. Higher is better. */
export function scoreOfferMatch(
  offer: ProductOffer,
  query: string,
  opts?: { targetMassKg?: number },
): number {
  const qAll = tokens(query);
  const qCore = qAll.filter((t) => !SOFT.has(t));
  const qSoft = qAll.filter((t) => SOFT.has(t));
  const name = tokens(offer.name);
  if (qCore.length === 0 || name.length === 0) return -Infinity;

  const nameJoined = name.join(" ");
  for (const bad of REJECT_IF_PRESENT) {
    if (nameJoined.includes(bad) && !qCore.includes(bad)) return -Infinity;
  }

  let coreHits = 0;
  for (const t of qCore) {
    if (tokenHit(t, name)) coreHits += 1;
  }
  if (coreHits < qCore.length) return -Infinity;

  let softHits = 0;
  for (const t of qSoft) {
    if (
      tokenHit(t, name) ||
      (offer.packageSize && tokenHit(t, tokens(offer.packageSize)))
    ) {
      softHits += 1;
    }
  }

  if (offer.confidence === "estimated" && offer.price >= 100) return -Infinity;
  if (offer.price <= 0) return -Infinity;

  const confBonus = offer.confidence === "exact" ? 1 : 0;
  const softBonus = qSoft.length ? softHits / qSoft.length : 0;
  const pricePenalty = offer.price > 40 ? 1 : 0;
  const massBonus =
    opts?.targetMassKg != null ? scoreMassMatch(offer, opts.targetMassKg) : 0;

  return 10 + confBonus + softBonus + massBonus - pricePenalty;
}

export type OfferPickMode = "preferred" | "cheapest";

/**
 * Among offers that match the query, pick the lowest fair price.
 * Uses $/kg when mass/unit price is known (produce), otherwise shelf price.
 * Brand / preferred SKU is ignored — call only when matchMode=cheapest.
 */
export function pickCheapestOffer(
  offers: ProductOffer[],
  query: string,
  opts?: {
    targetMassKg?: number;
    /** Prefer comparing by $/kg when resolvable (default true). */
    byUnitPrice?: boolean;
  },
): ProductOffer | null {
  if (offers.length === 0) return null;

  const byUnit = opts?.byUnitPrice !== false;
  type Ranked = {
    offer: ProductOffer;
    matchScore: number;
    sortPrice: number;
  };
  const ranked: Ranked[] = [];

  for (const offer of offers) {
    const matchScore = scoreOfferMatch(offer, query, opts);
    if (matchScore === -Infinity) continue;

    let sortPrice = offer.price;
    if (byUnit) {
      const units = resolveUnitPrices(offer, {
        forceSoldByWeight: false,
      });
      if (units?.pricePerKg && units.pricePerKg > 0) {
        sortPrice = units.pricePerKg;
      }
    }
    if (!(sortPrice > 0)) continue;
    ranked.push({ offer, matchScore, sortPrice });
  }

  if (!ranked.length) return null;

  ranked.sort((a, b) => {
    if (a.sortPrice !== b.sortPrice) return a.sortPrice - b.sortPrice;
    return b.matchScore - a.matchScore;
  });
  return ranked[0]!.offer;
}

export function pickBestOffer(
  offers: ProductOffer[],
  query: string,
  preferredId?: string,
  opts?: { targetMassKg?: number; mode?: OfferPickMode },
): ProductOffer | null {
  if (offers.length === 0) return null;

  if (opts?.mode === "cheapest") {
    return pickCheapestOffer(offers, query, opts);
  }

  if (preferredId) {
    const hit = offers.find((o) => o.productId === preferredId);
    if (hit) return hit;
  }

  let best: ProductOffer | null = null;
  let bestScore = -Infinity;
  for (const offer of offers) {
    const score = scoreOfferMatch(offer, query, opts);
    if (score > bestScore) {
      bestScore = score;
      best = offer;
    }
  }

  if (bestScore === -Infinity) return null;
  return best;
}
