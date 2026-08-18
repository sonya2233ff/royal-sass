/**
 * Fair cross-store compare — adapted from daam-kemon (type+size buckets)
 * and SmartCart (EAN/UPC first, then size-checked fuzzy).
 *
 * Do not compare different pack masses as raw shelf prices.
 * Mass deals are quoted per 100 g (Canadian shelf unit).
 */
import { parseMassFromText, round2 } from "@/domain/units";

export type FairBasis =
  | "per_100g"
  | "per_egg"
  | "per_pack"
  | "needed_weight"
  | "incomparable";

export type MatchKind =
  | "upc"
  | "preferred_sku"
  | "brand_size"
  | "category_cheapest"
  | "fuzzy";

export function normalizeUpc(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 14) return null;
  return digits.replace(/^0+/, "") || digits;
}

export function upcsMatch(a?: string | null, b?: string | null): boolean {
  const x = normalizeUpc(a);
  const y = normalizeUpc(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const longer = x.length >= y.length ? x : y;
  const shorter = x.length >= y.length ? y : x;
  return longer.endsWith(shorter) && shorter.length >= 8;
}

export function extractBarcodes(
  ...texts: Array<string | undefined | null>
): string[] {
  const out: string[] = [];
  for (const t of texts) {
    if (!t) continue;
    for (const m of String(t).matchAll(/\b(\d{8,14})\b/g)) {
      const n = normalizeUpc(m[1]);
      if (n) out.push(n);
    }
  }
  return [...new Set(out)];
}

export function packMassKg(
  name?: string | null,
  packageSize?: string | null,
  parsed?: number | null,
): number | null {
  if (parsed != null && Number.isFinite(parsed) && parsed > 0) return parsed;
  const mass = parseMassFromText(`${packageSize ?? ""} ${name ?? ""}`);
  return mass && mass.kg > 0 ? mass.kg : null;
}

export function pricePerKgFromPack(
  price: number,
  name?: string | null,
  packageSize?: string | null,
  parsed?: number | null,
): number | null {
  const kg = packMassKg(name, packageSize, parsed);
  if (kg == null || kg <= 0 || !(price > 0)) return null;
  return round2(price / kg);
}

/** Canadian shelf unit. Same ranking as $/kg (÷10). */
export function pricePer100gFromKg(perKg: number): number {
  return round2(perKg / 10);
}

export function packsSimilar(aKg: number, bKg: number, tol = 0.2): boolean {
  const denom = Math.min(aKg, bKg);
  if (!(denom > 0)) return false;
  return Math.abs(aKg - bKg) / denom <= tol;
}

export function classifyMatchKind(input: {
  mode: "preferred" | "cheapest";
  preferredId?: string | null;
  productId: string;
  upc?: string | null;
  targetUpcs?: string[];
}): MatchKind {
  if (input.targetUpcs?.some((u) => upcsMatch(input.upc, u))) return "upc";
  if (input.preferredId && input.productId === input.preferredId) {
    return "preferred_sku";
  }
  if (input.mode === "cheapest") return "category_cheapest";
  return "fuzzy";
}

export interface FairSideInput {
  ok: boolean;
  shelfPrice?: number | null;
  lineTotal?: number | null;
  /** Real mass-based $/kg — never per-egg. */
  pricePerKg?: number | null;
  pricePerEach?: number | null;
  packKg?: number | null;
  isEgg?: boolean;
}

export interface FairCompareResult {
  cheaper: "walmart" | "nofrills" | "wholesaleclub" | "mvr" | "tie" | "incomplete";
  /** Walmart fair − No Frills fair when only two sides; else cheapest − next. Negative means first listed is cheaper. */
  delta: number | null;
  fairBasis: FairBasis;
  fairLabel: string;
  wmFair: number | null;
  nfFair: number | null;
  wcFair?: number | null;
  mvrFair?: number | null;
}

function usable(side: FairSideInput): boolean {
  return side.ok;
}

function per100gDeal(
  wmPerKg: number,
  nfPerKg: number,
  fairLabel: string,
): FairCompareResult {
  const wmFair = pricePer100gFromKg(wmPerKg);
  const nfFair = pricePer100gFromKg(nfPerKg);
  return {
    cheaper: winner(wmFair, nfFair),
    delta: round2(wmFair - nfFair),
    fairBasis: "per_100g",
    fairLabel,
    wmFair,
    nfFair,
  };
}

function winner(
  wm: number,
  nf: number,
): "walmart" | "nofrills" | "tie" {
  if (Math.abs(wm - nf) < 0.005) return "tie";
  return wm < nf ? "walmart" : "nofrills";
}

export type FairStoreId = "walmart" | "nofrills" | "wholesaleclub" | "mvr";

function cheapestStore(
  values: Partial<Record<FairStoreId, number | null | undefined>>,
): FairStoreId | "tie" | "incomplete" {
  const entries = (Object.entries(values) as Array<[FairStoreId, number | null | undefined]>)
    .filter((row): row is [FairStoreId, number] => row[1] != null && Number.isFinite(row[1]));
  if (entries.length < 2) return "incomplete";
  const min = Math.min(...entries.map(([, v]) => v));
  const winners = entries.filter(([, v]) => Math.abs(v - min) < 0.005).map(([k]) => k);
  return winners.length === 1 ? winners[0] : "tie";
}

function spreadDelta(
  values: Partial<Record<FairStoreId, number | null | undefined>>,
  preferWmNf: boolean,
): number | null {
  const wm = values.walmart;
  const nf = values.nofrills;
  if (preferWmNf && wm != null && nf != null) return round2(wm - nf);
  const nums = [
    values.walmart,
    values.nofrills,
    values.wholesaleclub,
    values.mvr,
  ].filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  if (nums.length < 2) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  return round2(sorted[0] - sorted[1]);
}

/** Same 2-store rules, plus WC and MVR when those sides are usable. WM vs NF ranking is unchanged if extras are missing. */
export function fairCompareThree(
  wm: FairSideInput,
  nf: FairSideInput,
  wc?: FairSideInput | null,
  mvr?: FairSideInput | null,
): FairCompareResult {
  const two = fairCompareSides(wm, nf);
  const extrasOk = Boolean(wc?.ok || mvr?.ok);
  if (!extrasOk) {
    return { ...two, wcFair: null, mvrFair: null };
  }

  const candidates: Array<[FairStoreId, FairSideInput]> = [
    ["walmart", wm],
    ["nofrills", nf],
    ...(wc?.ok ? ([["wholesaleclub", wc]] as Array<[FairStoreId, FairSideInput]>) : []),
    ...(mvr?.ok ? ([["mvr", mvr]] as Array<[FairStoreId, FairSideInput]>) : []),
  ];
  const sides = candidates.filter((row) => row[1].ok);

  const withFairs = (
    values: Partial<Record<FairStoreId, number | null | undefined>>,
    rest: Omit<FairCompareResult, "wmFair" | "nfFair" | "wcFair" | "mvrFair" | "cheaper" | "delta"> & {
      cheaper: FairCompareResult["cheaper"];
      delta: number | null;
    },
  ): FairCompareResult => ({
    ...rest,
    wmFair: values.walmart ?? null,
    nfFair: values.nofrills ?? null,
    wcFair: values.wholesaleclub ?? null,
    mvrFair: values.mvr ?? null,
  });

  if (sides.length < 2) {
    return { ...two, wcFair: null, mvrFair: null };
  }

  const eggSides = sides.filter(([, s]) => s.isEgg && s.pricePerEach);
  if (eggSides.length === sides.length && eggSides.length >= 2) {
    const values = Object.fromEntries(
      eggSides.map(([id, s]) => [id, s.pricePerEach as number]),
    ) as Partial<Record<FairStoreId, number>>;
    return withFairs(values, {
      cheaper: cheapestStore(values),
      delta: spreadDelta(values, !wc?.ok && !mvr?.ok),
      fairBasis: "per_egg",
      fairLabel: "за 1 яйце",
    });
  }

  const withKg = sides.map(([id, s]) => {
    const kg =
      s.pricePerKg && s.pricePerKg > 0
        ? s.pricePerKg
        : s.shelfPrice && s.packKg
          ? pricePerKgFromPack(s.shelfPrice, null, null, s.packKg)
          : null;
    return { id, s, kg };
  });
  const packs = withKg.filter((x) => x.s.packKg && x.s.shelfPrice);
  const allSimilar =
    packs.length === sides.length &&
    packs.length >= 2 &&
    packs.every((a) =>
      packs.every((b) => packsSimilar(a.s.packKg as number, b.s.packKg as number)),
    );
  if (allSimilar) {
    const values = Object.fromEntries(
      packs.map((x) => [x.id, x.s.shelfPrice as number]),
    ) as Partial<Record<FairStoreId, number>>;
    return withFairs(values, {
      cheaper: cheapestStore(values),
      delta: spreadDelta(values, false),
      fairBasis: "per_pack",
      fairLabel: "за пачку (схожий розмір)",
    });
  }

  const kgSides = withKg.filter((x) => x.kg && x.kg > 0);
  if (kgSides.length === sides.length && kgSides.length >= 2) {
    const values = Object.fromEntries(
      kgSides.map((x) => [x.id, pricePer100gFromKg(x.kg as number)]),
    ) as Partial<Record<FairStoreId, number>>;
    const mixedPacks = packs.length >= 2 && !allSimilar;
    return withFairs(values, {
      cheaper: cheapestStore(values),
      delta: spreadDelta(values, false),
      fairBasis: "per_100g",
      fairLabel: mixedPacks ? "за 100 г (різні пачки)" : "за 100 г",
    });
  }

  const lines = sides.filter(
    ([, s]) => s.lineTotal != null && s.lineTotal > 0,
  );
  if (lines.length === sides.length && lines.length >= 2) {
    const values = Object.fromEntries(
      lines.map(([id, s]) => [id, s.lineTotal as number]),
    ) as Partial<Record<FairStoreId, number>>;
    return withFairs(values, {
      cheaper: cheapestStore(values),
      delta: spreadDelta(values, false),
      fairBasis: "per_pack",
      fairLabel: "за позицію",
    });
  }

  return { ...two, wcFair: wc?.ok ? two.wcFair ?? null : null, mvrFair: null };
}

export function fairCompareSides(
  wm: FairSideInput,
  nf: FairSideInput,
): FairCompareResult {
  const incomplete = (): FairCompareResult => ({
    cheaper: "incomplete",
    delta: null,
    fairBasis: "incomparable",
    fairLabel: "немає порівнянної ціни",
    wmFair: null,
    nfFair: null,
  });

  if (!usable(wm) || !usable(nf)) return incomplete();

  if (wm.isEgg && nf.isEgg && wm.pricePerEach && nf.pricePerEach) {
    return {
      cheaper: winner(wm.pricePerEach, nf.pricePerEach),
      delta: round2(wm.pricePerEach - nf.pricePerEach),
      fairBasis: "per_egg",
      fairLabel: "за 1 яйце",
      wmFair: wm.pricePerEach,
      nfFair: nf.pricePerEach,
    };
  }

  const wmKg =
    wm.pricePerKg && wm.pricePerKg > 0
      ? wm.pricePerKg
      : wm.shelfPrice && wm.packKg
        ? pricePerKgFromPack(wm.shelfPrice, null, null, wm.packKg)
        : null;
  const nfKg =
    nf.pricePerKg && nf.pricePerKg > 0
      ? nf.pricePerKg
      : nf.shelfPrice && nf.packKg
        ? pricePerKgFromPack(nf.shelfPrice, null, null, nf.packKg)
        : null;

  if (wm.packKg && nf.packKg && wm.shelfPrice && nf.shelfPrice) {
    if (packsSimilar(wm.packKg, nf.packKg)) {
      return {
        cheaper: winner(wm.shelfPrice, nf.shelfPrice),
        delta: round2(wm.shelfPrice - nf.shelfPrice),
        fairBasis: "per_pack",
        fairLabel: "за пачку (схожий розмір)",
        wmFair: wm.shelfPrice,
        nfFair: nf.shelfPrice,
      };
    }
    if (wmKg && nfKg) {
      return per100gDeal(wmKg, nfKg, "за 100 г (різні пачки)");
    }
  }

  if (wmKg && nfKg) {
    return per100gDeal(wmKg, nfKg, "за 100 г");
  }

  if (
    wm.lineTotal != null &&
    nf.lineTotal != null &&
    wm.lineTotal > 0 &&
    nf.lineTotal > 0
  ) {
    return {
      cheaper: winner(wm.lineTotal, nf.lineTotal),
      delta: round2(wm.lineTotal - nf.lineTotal),
      fairBasis: "per_pack",
      fairLabel: "за позицію",
      wmFair: wm.lineTotal,
      nfFair: nf.lineTotal,
    };
  }

  return incomplete();
}

/** Amount to add to a like-for-like basket total for this row. */
export function basketAmountForSide(
  fair: FairCompareResult,
  side: FairStoreId,
  fallbackLine: number | null,
): number | null {
  if (fair.fairBasis === "incomparable") return null;
  const v =
    side === "walmart"
      ? fair.wmFair
      : side === "nofrills"
        ? fair.nfFair
        : side === "mvr"
          ? (fair.mvrFair ?? null)
        : (fair.wcFair ?? null);
  if (fair.fairBasis === "needed_weight" && v != null) return v;
  // Quote the deal per 100 g; basket line is still 1 kg (10 × 100 g).
  if (fair.fairBasis === "per_100g" && v != null) return round2(v * 10);
  if (fair.fairBasis === "per_egg" && v != null) {
    return round2(v * 30);
  }
  if (v != null && fair.fairBasis === "per_pack") return v;
  return fallbackLine;
}

/** Scale a 1-unit basket line by the shopper's qty (kg or pack count). */
export function scaleBasketAmount(
  amount: number | null,
  fair: FairCompareResult,
  opts?: { packQty?: number; qtyKg?: number },
): number | null {
  if (amount == null || fair.fairBasis === "incomparable") return null;
  if (fair.fairBasis === "needed_weight") return amount;
  if (fair.fairBasis === "per_100g") {
    const kg = opts?.qtyKg != null && opts.qtyKg > 0 ? opts.qtyKg : 1;
    return round2(amount * kg);
  }
  const packs =
    opts?.packQty != null && Number.isFinite(opts.packQty) && opts.packQty > 0
      ? opts.packQty
      : 1;
  return round2(amount * packs);
}
