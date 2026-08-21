"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { ProductSearch } from "./ProductSearch";
import { ProductSettings } from "./ProductSettings";
import { ReceiptUpload } from "./ReceiptUpload";
import { OfferAuditGrid, OfferVerdictButtons, storeOfferCell } from "./OfferAudit";
import {
  addCartItem,
  applyProductOverride,
  cartSize,
  clearCart,
  removeCartItem,
  setCartCustomAmount,
  stapleForcesExactMatch,
  toRestaurantProduct,
  type AmountUnit,
  type Cart,
  type ProductOverride,
  type RestaurantProduct,
} from "@/domain/restaurant-product";
import {
  EGG_COUNT_PRESETS,
  isEggPackStaple,
  typicalEggCartonCount,
  ukEggCountLabel,
} from "@/domain/egg-pack";
import { stapleMatchesCatalogQuery } from "@/domain/staple-search";
import { offerFailsProductSettings } from "@/domain/catalog-normalize";
import { identityLockAllowsFilterMismatch } from "@/domain/compare-resolve";
import {
  cheaperSaleHint,
  cheaperSaleOffers,
  isShelfSale,
  saleOffersFromPrices,
  saleWasPrice,
} from "@/domain/shelf-sale";
import type { ReceiptStapleDraft } from "@/domain/receipt-import";
import {
  CART_STORAGE_KEY,
  dropCustomStaples,
  mergeOverrideMaps,
  parseOverrideMap,
  readCustomStaples,
  readProductOverrides,
  readRemovedStapleIds,
  upsertCustomStaples,
  writeProductOverrides,
  writeRemovedStapleIds,
} from "@/lib/product-config";
import { mergeServerItemsWithCustom } from "@/lib/custom-staple-card";
import { toBase } from "@/domain/purchase-units";
import {
  looseWeightPurchase,
  purchasePlanForPack,
} from "@/domain/needed-weight-pick";
import { completeBasketWinner } from "@/domain/basket-coverage";
import {
  linesFromBasketRows,
  recommendPurchasePlans,
  storePlanLabel,
  storePlanShort,
  type PurchasePlan,
} from "@/domain/purchase-plans";
import {
  COMPARE_STORES,
  cheaperAmongStores,
  type CompareStoreId,
} from "@/domain/compare-stores";
import {
  countOfferAuditProgress,
  mergeOfferVerdictMaps,
  offerVerdictPayload,
  parseOfferVerdictMap,
  stapleHasNoVerdict,
  stapleHasUnratedStore,
  toggleOfferVerdict,
  type OfferAuditCell,
  type OfferVerdictMap,
  type OfferVerdictValue,
} from "@/domain/offer-verdicts";
import {
  readAuditMode,
  readOfferVerdicts,
  writeAuditMode,
  writeOfferVerdicts,
} from "@/lib/offer-verdicts";
import { useCompareStores } from "./CompareStoresContext";

type OfferStatus =
  | "ok"
  | "unavailable"
  | "wrong_pack"
  | "wrong_size"
  | "stale"
  | "no_match"
  | "rejected";

type Staple = {
  id: string;
  label: string;
  image: string | null;
  searchHay?: string;
  queries?: string[];
  mustIncludeAny?: string[];
  mustIncludeAll?: string[];
  notes?: string;
  status: OfferStatus;
  statusReason?: string | null;
  ageLabel?: string | null;
  confirmed?: boolean;
  preferredProductId?: string | null;
  matchMode?: "preferred" | "cheapest" | "exact" | "cheapest_equivalent";
  restaurantProduct?: RestaurantProduct;
  weightCompare?: boolean;
  soldByWeight?: boolean;
  typicalEachGrams?: number | null;
  eggCountChoices?: number[] | null;
  largestEggPack?: number | null;
  walmartCached: {
    name: string;
    price: number;
    productId: string;
    packageSize?: string;
    parsedMassKg?: number | null;
    checkedAt?: string;
    pricePerKg?: number | null;
    pricePerLb?: number | null;
    nativeUnit?: "kg" | "lb" | null;
    nativeUnitPrice?: number | null;
    nativeUnitLabel?: string | null;
    nativeUnitPriceLabel?: string | null;
    wasPrice?: number | null;
    onSale?: boolean;
    image?: string | null;
    packs?: number | null;
    lineTotal?: number | null;
  } | null;
  noFrillsCached: {
    name: string;
    price: number;
    productId: string;
    packageSize?: string;
    parsedMassKg?: number | null;
    checkedAt?: string;
    ageLabel?: string | null;
    pricePerKg?: number | null;
    pricePerLb?: number | null;
    nativeUnit?: "kg" | "lb" | null;
    nativeUnitPrice?: number | null;
    nativeUnitLabel?: string | null;
    nativeUnitPriceLabel?: string | null;
    wasPrice?: number | null;
    onSale?: boolean;
    image?: string | null;
    packs?: number | null;
    lineTotal?: number | null;
  } | null;
  wholesaleClubCached?: {
    name: string;
    price: number;
    productId: string;
    packageSize?: string;
    parsedMassKg?: number | null;
    checkedAt?: string;
    ageLabel?: string | null;
    pricePerKg?: number | null;
    pricePerLb?: number | null;
    nativeUnit?: "kg" | "lb" | null;
    nativeUnitPrice?: number | null;
    nativeUnitLabel?: string | null;
    nativeUnitPriceLabel?: string | null;
    wasPrice?: number | null;
    onSale?: boolean;
    image?: string | null;
    packs?: number | null;
    lineTotal?: number | null;
  } | null;
  mvrCached?: {
    name: string;
    price: number;
    productId: string;
    packageSize?: string;
    parsedMassKg?: number | null;
    checkedAt?: string;
    ageLabel?: string | null;
    pricePerKg?: number | null;
    pricePerLb?: number | null;
    nativeUnit?: "kg" | "lb" | null;
    nativeUnitPrice?: number | null;
    nativeUnitLabel?: string | null;
    nativeUnitPriceLabel?: string | null;
    wasPrice?: number | null;
    onSale?: boolean;
    image?: string | null;
    packs?: number | null;
    lineTotal?: number | null;
  } | null;
  sobeysCached?: {
    name: string;
    price: number;
    productId: string;
    packageSize?: string;
    parsedMassKg?: number | null;
    checkedAt?: string;
    image?: string | null;
    priceConfidence?: "ESTIMATED";
    source?: string;
    flyerValidTo?: string | null;
    ageLabel?: string | null;
  } | null;
  onSale?: boolean;
  custom?: boolean;
};

type SideResult = {
  name?: string;
  shelfPrice?: number;
  lineTotal: number | null;
  note?: string;
  compareUnitLabel?: string | null;
  status?: OfferStatus;
  statusReason?: string;
  ageLabel?: string | null;
  onSale?: boolean;
  wasPrice?: number | null;
  productId?: string;
  pricePerKg?: number;
  pricePerLb?: number;
  nativeUnit?: "kg" | "lb";
  nativeUnitPrice?: number;
  nativeUnitLabel?: string;
  nativeUnitPriceLabel?: string;
  image?: string | null;
  leftoverAmount?: number;
  leftoverUnit?: string;
  packsNeeded?: number;
  saleMode?: string;
  requestedAmount?: number;
  requestedUnit?: string;
  checkout?: {
    valid?: boolean;
    reason?: string;
    warning?: string;
    saleMode?: string;
    packs?: number;
    packAmount?: number | null;
    packUnit?: string | null;
    purchasedAmount?: number;
    leftoverAmount?: number;
    leftoverUnit?: string;
    shelfPrice?: number;
    checkoutCost?: number | null;
    unitPrice?: number | null;
  } | null;
  matchStatus?: string;
  purchase?: {
    neededGrams: number;
    packGrams: number;
    packs: number;
    gotGrams: number;
    deltaGrams: number;
    deltaPct: number;
    totalPrice: number;
    pricePer100g: number;
    inRange: boolean;
    coverFallback: boolean;
    soldByWeight: boolean;
    name: string;
    image?: string;
  } | null;
};

type CompareRow = {
  id: string;
  label: string;
  image: string | null;
  confirmed?: boolean;
  walmart: SideResult;
  noFrills: SideResult;
  wholesaleClub?: SideResult;
  mvr?: SideResult;
  cheaper: string;
  delta: number | null;
  soldByWeight?: boolean;
  grams?: number | null;
  qty?: number;
  fairLabel?: string | null;
  fairBasis?: string | null;
  matchKind?: string | null;
  requestedAmount?: number;
  requestedUnit?: string;
  purchaseStrategy?: string;
  matchModeCanonical?: string;
  basketWalmart?: number | null;
  basketNoFrills?: number | null;
  basketWholesaleClub?: number | null;
  basketMvr?: number | null;
};

type StoreCoverage = {
  requestedItems: number;
  availableComparableItems: number;
  checkoutTotal: number | null;
  complete: boolean;
  coverage?: string;
};

type CompareTotals = {
  walmart: number | null;
  noFrills: number | null;
  wholesaleClub?: number | null;
  mvr?: number | null;
  cheaper: string;
  cheaperTwoWay?: string;
  cheaperThree?: string;
  completeCount: number;
  tripleCount?: number;
  quadCount?: number;
  note?: string;
  requestedItems?: number;
  walmartComplete?: StoreCoverage;
  noFrillsComplete?: StoreCoverage;
  wholesaleClubComplete?: StoreCoverage;
  mvrComplete?: StoreCoverage;
  incompleteItems?: Array<{ id: string; label: string; missing: string[] }>;
};

function tidyOfferName(name: string): string {
  const parts = name
    .split(/\s*,\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out.join(", ");
}

function storePriceLine(
  tag: string,
  cached: {
    price: number;
    packs?: number | null;
    lineTotal?: number | null;
    packageSize?: string;
    onSale?: boolean;
    wasPrice?: number | null;
  },
  extra?: { cheaperSale?: boolean },
) {
  const packs = cached.packs != null && cached.packs > 1 ? cached.packs : 1;
  const total =
    packs > 1 && cached.lineTotal != null ? cached.lineTotal : cached.price;
  const sale = isShelfSale(cached);
  const was = saleWasPrice(cached);
  return (
    <span className="price">
      {packs > 1
        ? `${tag} ${packs} × $${cached.price.toFixed(2)} = $${total.toFixed(2)}`
        : `${tag} $${cached.price.toFixed(2)}`}
      {sale && was ? <s className="was">${was.toFixed(2)}</s> : null}
      {sale ? (
        <span className={extra?.cheaperSale ? "sale-now cheap" : "sale-now"}>
          {extra?.cheaperSale ? " дешевше · знижка" : " знижка"}
        </span>
      ) : null}
      {cached.packageSize ? ` · ${cached.packageSize}` : ""}
    </span>
  );
}

function saleTitle(item: Staple): string {
  const bits: string[] = [];
  const add = (
    tag: string,
    cached:
      | {
          price: number;
          onSale?: boolean;
          wasPrice?: number | null;
        }
      | null
      | undefined,
  ) => {
    if (!cached || !isShelfSale(cached)) return;
    const was = saleWasPrice(cached);
    bits.push(
      was
        ? `${tag} знижка: $${cached.price.toFixed(2)}, було $${was.toFixed(2)}`
        : `${tag} зараз на знижці · $${cached.price.toFixed(2)}`,
    );
  };
  add("WM", item.walmartCached);
  add("NF", item.noFrillsCached);
  add("WC", item.wholesaleClubCached);
  add("MVR", item.mvrCached);
  return bits.join(" · ") || "Зараз на знижці";
}

function compareSideCheaperSale(
  cheaper: string,
  store: string,
  side: SideResult,
): boolean {
  const price = side.shelfPrice ?? side.checkout?.shelfPrice ?? side.lineTotal;
  if (
    !isShelfSale({
      price,
      wasPrice: side.wasPrice,
      onSale: side.onSale,
    })
  ) {
    return false;
  }
  return cheaper === store || cheaper === "tie";
}

function withVisibleOffers(item: Staple, product: RestaurantProduct): Staple {
  const keep = <T extends { name: string; productId: string }>(
    offer: T | null | undefined,
  ): T | null => {
    if (!offer) return null;
    if (identityLockAllowsFilterMismatch(product, offer)) return offer;
    if (offerFailsProductSettings(product, offer)) return null;
    return offer;
  };
  return {
    ...item,
    walmartCached: keep(item.walmartCached),
    noFrillsCached: keep(item.noFrillsCached),
    wholesaleClubCached: keep(item.wholesaleClubCached ?? null),
    mvrCached: keep(item.mvrCached ?? null),
  };
}

function matchCategory(mode?: string): {
  key: "a" | "b";
  short: string;
  title: string;
} {
  if (mode === "cheapest" || mode === "cheapest_equivalent") {
    return {
      key: "b",
      short: "Б · найдешевший відповідний",
      title:
        "Найдешевший відповідний: бренд неважливий, тип/форма/призначення мають збігатися",
    };
  }
  return {
    key: "a",
    short: "А · точний продукт",
    title: "Точний продукт: бренд, вид, варіант і розмір",
  };
}

function statusLabel(s?: OfferStatus | string | null): string {
  switch (s) {
    case "ok":
      return "ok";
    case "unavailable":
      return "немає в магазині";
    case "wrong_pack":
      return "wrong pack";
    case "wrong_size":
      return "wrong size";
    case "stale":
      return "stale cache";
    case "no_match":
      return "no match";
    case "rejected":
      return "rejected";
    default:
      return s ?? "—";
  }
}

function friendlyError(msg: string): string {
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return "Немає зв'язку з локальним API (/api/staples). Перевір, що `npm run dev` ще запущений, і відкривай http://localhost:3000 (не з телефону на 127.0.0.1).";
  }
  if (/Refusing to scrape walmart\.ca|RAPIDAPI_KEY are empty/i.test(msg)) {
    return "RapidAPI вибрано, але ключ порожній. Сайт walmart.ca не чіпаємо (PerimeterX). Додай OPENWEBNINJA_API_KEY або RAPIDAPI_KEY у .env і на Vercel.";
  }
  return msg;
}

function categoryBPreview(
  side: Staple["walmartCached"],
  neededG: number | null,
  soldByWeight: boolean,
  typicalEachGrams?: number | null,
) {
  if (!side || neededG == null || !(neededG > 0)) return null;
  if (soldByWeight && side.pricePerKg) {
    return looseWeightPurchase({
      neededGrams: neededG,
      pricePerKg: side.pricePerKg,
      productId: side.productId,
      name: side.name,
      image: side.image ?? undefined,
      shelfPrice: side.price,
    });
  }
  if (soldByWeight) return null;
  return purchasePlanForPack(neededG, {
    productId: side.productId,
    name: side.name,
    price: side.price,
    packageSize: side.packageSize,
    parsedMassKg: side.parsedMassKg ?? undefined,
    typicalEachGrams: typicalEachGrams ?? undefined,
    image: side.image ?? undefined,
  });
}

function amountLabel(item: { id: string }, amount: number, unit: string): string {
  if (isEggPackStaple(item)) return ukEggCountLabel(amount);
  return `${amount} ${unit}`;
}

function formatBBuy(plan: NonNullable<ReturnType<typeof categoryBPreview>>): string {
  if (plan.soldByWeight) {
    return `потрібно ${plan.neededGrams} g · $${plan.totalPrice.toFixed(2)} · $${plan.pricePer100g.toFixed(2)}/100g`;
  }
  const gap =
    plan.deltaGrams === 0
      ? "без відхилення"
      : plan.deltaGrams < 0
        ? `недостача ${Math.abs(plan.deltaGrams)} g (${Math.abs(plan.deltaPct)}%)`
        : `надлишок ${plan.deltaGrams} g (+${plan.deltaPct}%)`;
  const extra = plan.coverFallback ? " · перевищує бажану кількість" : "";
  return `потрібно ${plan.neededGrams} g · ${plan.packs} × ${plan.packGrams} g = ${plan.gotGrams} g · ${gap} · $${plan.totalPrice.toFixed(2)} · $${plan.pricePer100g.toFixed(2)}/100g${extra}`;
}

function cheaperLabel(cheaper: string): string {
  if (cheaper === "walmart") return "Walmart cheaper";
  if (cheaper === "nofrills") return "No Frills cheaper";
  if (cheaper === "wholesaleclub") return "Wholesale Club cheaper";
  if (cheaper === "mvr") return "MVR cheaper";
  if (cheaper === "tie") return "Tie";
  return "Incomplete";
}

const STORE_MISSING_LABEL: Record<CompareStoreId, string> = {
  walmart: "Walmart",
  nofrills: "No Frills",
  wholesaleclub: "Wholesale Club",
  mvr: "MVR",
};

function sideLineTotal(side?: { lineTotal?: number | null } | null): number | null {
  const n = side?.lineTotal;
  return n != null && Number.isFinite(n) ? n : null;
}

function storeShort(cheaper: string): string {
  if (cheaper === "walmart") return "Walmart";
  if (cheaper === "nofrills") return "No Frills";
  if (cheaper === "wholesaleclub") return "Wholesale Club";
  if (cheaper === "mvr") return "MVR";
  if (cheaper === "tie") return "нічия";
  return "неповне";
}

function planHeadline(plan: PurchasePlan): string {
  if (plan.stopCount === 1 && plan.stops[0]) {
    return plan.complete
      ? `Все в ${storePlanLabel(plan.stops[0].store)}`
      : `${storePlanLabel(plan.stops[0].store)} · неповний кошик`;
  }
  return plan.stops.map((s) => storePlanLabel(s.store)).join(" + ");
}

function planStopItems(labels: string[]): string {
  const shown = labels.slice(0, 4);
  const extra = labels.length > 4 ? ` +${labels.length - 4}` : "";
  return shown.join(", ") + extra;
}

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "N/A";
  return `$${n.toFixed(2)}`;
}

/** Store basket totals: missing/incomplete is N/A, never $0.00. */
function moneyBasket(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "N/A";
  return `$${n.toFixed(2)}`;
}

function torontoWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("uk-UA", {
    timeZone: "America/Toronto",
    dateStyle: "short",
    timeStyle: "short",
  });
}

type StatsRunItem = {
  id: string;
  label: string;
  qty: number;
  grams: number | null;
  cheaper: string;
  delta: number | null;
  walmart: number | null;
  noFrills: number | null;
  wholesaleClub: number | null;
  mvr: number | null;
};

type StatsRun = {
  id: string;
  comparedAt: string;
  itemCount: number;
  items: StatsRunItem[];
  totals: {
    completeCount: number;
    walmart: number | null;
    noFrills: number | null;
    wholesaleClub: number | null;
    mvr: number | null;
    cheaper: string;
    tripleCount?: number;
    quadCount?: number;
  };
};

type StatsSummary = {
  runCount: number;
  lastComparedAt: string | null;
  itemCompares: number;
  uniqueItems: number;
  basketWins: Record<string, number>;
  topItems: Array<{
    id: string;
    label: string;
    times: number;
    wins: Record<string, number>;
  }>;
};

const STATS_STORAGE_KEY = "royal-sass-compare-history-v1";

function isStatsRun(value: unknown): value is StatsRun {
  if (!value || typeof value !== "object") return false;
  const row = value as StatsRun;
  return (
    typeof row.id === "string" &&
    typeof row.comparedAt === "string" &&
    Array.isArray(row.items) &&
    row.totals != null
  );
}

function readLocalStatsRuns(): StatsRun[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STATS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { runs?: unknown } | unknown;
    const runs = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { runs?: unknown }).runs)
        ? (parsed as { runs: unknown[] }).runs
        : [];
    return runs.filter(isStatsRun);
  } catch {
    return [];
  }
}

function writeLocalStatsRuns(runs: StatsRun[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STATS_STORAGE_KEY,
      JSON.stringify({
        updatedAt: new Date().toISOString(),
        runs: runs.slice(0, 200),
      }),
    );
  } catch {
    // Private mode / quota — stats stay in memory for this visit.
  }
}

function mergeStatsRuns(server: StatsRun[], local: StatsRun[]): StatsRun[] {
  const map = new Map<string, StatsRun>();
  for (const row of [...local, ...server]) {
    if (isStatsRun(row)) map.set(row.id, row);
  }
  return [...map.values()]
    .sort((a, b) =>
      a.comparedAt === b.comparedAt
        ? b.id.localeCompare(a.id)
        : a.comparedAt < b.comparedAt
          ? 1
          : -1,
    )
    .slice(0, 200);
}

function summarizeLocalStats(runs: StatsRun[]): StatsSummary {
  const basketWins: Record<string, number> = {};
  const byItem = new Map<string, StatsSummary["topItems"][number]>();
  for (const run of runs) {
    const winner = run.totals.cheaper || "incomplete";
    basketWins[winner] = (basketWins[winner] ?? 0) + 1;
    for (const item of run.items) {
      const cur = byItem.get(item.id) ?? {
        id: item.id,
        label: item.label,
        times: 0,
        wins: {},
      };
      cur.times += 1;
      cur.label = item.label;
      const key = item.cheaper || "incomplete";
      cur.wins[key] = (cur.wins[key] ?? 0) + 1;
      byItem.set(item.id, cur);
    }
  }
  return {
    runCount: runs.length,
    lastComparedAt: runs[0]?.comparedAt ?? null,
    itemCompares: runs.reduce((sum, run) => sum + run.itemCount, 0),
    uniqueItems: byItem.size,
    basketWins,
    topItems: [...byItem.values()]
      .sort((a, b) => b.times - a.times || a.label.localeCompare(b.label, "uk"))
      .slice(0, 20),
  };
}

function winLine(wins: Record<string, number> | undefined): string {
  if (!wins) return "";
  const order = ["walmart", "nofrills", "wholesaleclub", "mvr", "tie", "incomplete"];
  return order
    .filter((key) => (wins[key] ?? 0) > 0)
    .map((key) => `${storeShort(key)} ${wins[key]}`)
    .join(" · ");
}

function walmartSourceLabel(
  source: "rapid" | "browser" | "missing_key" | null,
): string {
  if (source === "rapid") return "WM ціни: RapidAPI";
  if (source === "missing_key") {
    return "WM ціни: RapidAPI без ключа — сайт не чіпаємо";
  }
  if (source === "browser") return "WM ціни: сайт walmart.ca";
  return "";
}

export function StaplesCompare() {
  const [items, setItems] = useState<Staple[]>([]);
  const [catalogReady, setCatalogReady] = useState(false);
  const [cart, setCart] = useState<Cart>({});
  const [overrides, setOverrides] = useState<Record<string, ProductOverride>>(
    {},
  );
  const [storageReady, setStorageReady] = useState(false);
  const [auditMode, setAuditMode] = useState(false);
  const [verdicts, setVerdicts] = useState<OfferVerdictMap>({});
  const [auditFilter, setAuditFilter] = useState<"all" | "unrated" | "no">(
    "unrated",
  );
  const [auditNotice, setAuditNotice] = useState<string | null>(null);
  const [auditCopyOpen, setAuditCopyOpen] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [qtyOpenId, setQtyOpenId] = useState<string | null>(null);
  const [showCart, setShowCart] = useState(false);
  const selected = useMemo(() => new Set(Object.keys(cart)), [cart]);
  const [rows, setRows] = useState<CompareRow[] | null>(null);
  const [totals, setTotals] = useState<CompareTotals | null>(null);
  const [matchLogId, setMatchLogId] = useState<string | null>(null);
  const [logPreview, setLogPreview] = useState<unknown[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [catalogAt, setCatalogAt] = useState<string | null>(null);
  const [nfCatalogAt, setNfCatalogAt] = useState<string | null>(null);
  const [wcCatalogAt, setWcCatalogAt] = useState<string | null>(null);
  const [mvrCatalogAt, setMvrCatalogAt] = useState<string | null>(null);
  const [sobeysCatalogAt, setSobeysCatalogAt] = useState<string | null>(null);
  const [staleHours, setStaleHours] = useState(24);
  const [query, setQuery] = useState("");
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [walmartSource, setWalmartSource] = useState<
    "rapid" | "browser" | "missing_key" | null
  >(null);
  const [walmartSourceWarning, setWalmartSourceWarning] = useState<
    string | null
  >(null);
  const [statsSummary, setStatsSummary] = useState<StatsSummary | null>(null);
  const [statsRuns, setStatsRuns] = useState<StatsRun[]>([]);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const { isOn, enabled, count: storeCount } = useCompareStores();

  const applyStats = useCallback(
    (payload: { summary?: StatsSummary; runs?: StatsRun[] } | null | undefined) => {
      const merged = mergeStatsRuns(
        Array.isArray(payload?.runs) ? payload.runs : [],
        readLocalStatsRuns(),
      );
      writeLocalStatsRuns(merged);
      setStatsRuns(merged.slice(0, 40));
      setStatsSummary(summarizeLocalStats(merged));
    },
    [],
  );

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/staples");
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `GET /api/staples ${res.status}${text ? `: ${text.slice(0, 160)}` : ""}`,
        );
      }
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "load failed");
      setItems(
        mergeServerItemsWithCustom(
          data.items,
          readCustomStaples(),
          readRemovedStapleIds(),
        ) as Staple[],
      );
      setCatalogAt(data.catalogCheckedAt ?? null);
      setNfCatalogAt(data.noFrillsCatalogCheckedAt ?? null);
      setWcCatalogAt(data.wholesaleClubCatalogCheckedAt ?? null);
      setMvrCatalogAt(data.mvrCatalogCheckedAt ?? null);
      setSobeysCatalogAt(data.sobeysCatalogCheckedAt ?? null);
      setStaleHours(data.cacheStaleHours ?? 24);
      setWalmartSource(data.walmartSource ?? null);
      setWalmartSourceWarning(data.walmartSourceWarning ?? null);
    } finally {
      setCatalogReady(true);
    }
  }, []);

  const reloadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/staples/compare-stats");
      const data = res.ok ? await res.json() : null;
      applyStats(data?.ok ? data : { runs: [] });
    } catch {
      applyStats({ runs: [] });
    }
  }, [applyStats]);

  useEffect(() => {
    let cancelled = false;
    reload().catch((e) =>
      setError(friendlyError(e instanceof Error ? e.message : String(e))),
    );
    reloadStats().catch(() => undefined);
    try {
      const rawCart = window.localStorage.getItem(CART_STORAGE_KEY);
      if (rawCart) {
        const parsed = JSON.parse(rawCart) as Cart;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          setCart(parsed);
        }
      }
      setOverrides(readProductOverrides());
      setRemovedIds(readRemovedStapleIds());
      setVerdicts(readOfferVerdicts());
      setAuditMode(readAuditMode());
    } catch {
      /* ignore */
    }
    setStorageReady(true);
    void fetch("/api/staples/product-config")
      .then((res) => res.json())
      .then((data: { ok?: boolean; overrides?: unknown }) => {
        if (cancelled || !data?.ok) return;
        const server = parseOverrideMap(data.overrides);
        if (!Object.keys(server).length) return;
        setOverrides((local) => {
          const merged = mergeOverrideMaps(server, local);
          writeProductOverrides(merged);
          return merged;
        });
      })
      .catch(() => undefined);
    void fetch("/api/staples/verdicts")
      .then((res) => res.json())
      .then((data: { ok?: boolean; verdicts?: unknown }) => {
        if (cancelled || !data?.ok) return;
        const server = parseOfferVerdictMap(data.verdicts);
        if (!Object.keys(server).length) return;
        setVerdicts((local) => {
          const merged = mergeOfferVerdictMaps(server, local);
          writeOfferVerdicts(merged);
          return merged;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [reload, reloadStats]);

  useEffect(() => {
    if (!storageReady) return;
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    } catch {
      /* ignore */
    }
  }, [cart, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    writeProductOverrides(overrides);
  }, [overrides, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    writeOfferVerdicts(verdicts);
  }, [verdicts, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    writeAuditMode(auditMode);
  }, [auditMode, storageReady]);

  useEffect(() => {
    if (!items.length) return;
    setCart((prev) => {
      let changed = false;
      const next: Cart = { ...prev };
      for (const [id, entry] of Object.entries(prev)) {
        if (!isEggPackStaple({ id }) || entry.unit !== "pack") continue;
        const carton = typicalEggCartonCount({ id });
        const amt =
          entry.requestedAmount <= 10
            ? Math.round(entry.requestedAmount * carton)
            : Math.round(entry.requestedAmount);
        next[id] = { ...entry, unit: "ea", requestedAmount: amt };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [items]);

  const productOf = useCallback((item: Staple): RestaurantProduct => {
    return applyProductOverride(
      item.restaurantProduct ??
        toRestaurantProduct({
          id: item.id,
          label: item.label,
          matchMode: item.matchMode,
          soldByWeight: item.soldByWeight,
          typicalEachGrams: item.typicalEachGrams ?? undefined,
        }),
      overrides[item.id],
    );
  }, [overrides]);

  const liveItems = useMemo(() => {
    if (!removedIds.length) return items;
    const gone = new Set(removedIds);
    return items.filter((item) => !gone.has(item.id));
  }, [items, removedIds]);

  const auditCellsFor = useCallback(
    (item: Staple): OfferAuditCell[] => {
      const cells: OfferAuditCell[] = [];
      if (isOn("walmart")) {
        cells.push(
          storeOfferCell(item.id, item.label, "walmart", item.walmartCached),
        );
      }
      if (isOn("nofrills")) {
        cells.push(
          storeOfferCell(item.id, item.label, "nofrills", item.noFrillsCached),
        );
      }
      if (isOn("wholesaleclub")) {
        cells.push(
          storeOfferCell(
            item.id,
            item.label,
            "wholesaleclub",
            item.wholesaleClubCached ?? null,
          ),
        );
      }
      if (isOn("mvr")) {
        cells.push(
          storeOfferCell(item.id, item.label, "mvr", item.mvrCached ?? null),
        );
      }
      return cells;
    },
    [isOn],
  );

  const visibleItems = useMemo(() => {
    const q = query.trim();
    const searched = q
      ? liveItems.filter((item) => stapleMatchesCatalogQuery(item, q))
      : liveItems;
    if (!auditMode || auditFilter === "all") return searched;
    return searched.filter((item) => {
      const cells = auditCellsFor(item);
      if (auditFilter === "no") return stapleHasNoVerdict(cells, verdicts);
      return stapleHasUnratedStore(cells, verdicts);
    });
  }, [liveItems, query, auditMode, auditFilter, auditCellsFor, verdicts]);

  const auditProgress = useMemo(() => {
    const cells = liveItems.flatMap((item) => auditCellsFor(item));
    return countOfferAuditProgress(cells, verdicts);
  }, [liveItems, auditCellsFor, verdicts]);

  const auditClipboard = useMemo(
    () => JSON.stringify(offerVerdictPayload(verdicts), null, 2),
    [verdicts],
  );

  function rateOffer(cell: OfferAuditCell, verdict: OfferVerdictValue) {
    setVerdicts((prev) => toggleOfferVerdict(prev, cell, verdict));
    setAuditNotice(null);
  }

  function sideAudit(
    id: string,
    label: string,
    store: CompareStoreId,
    side: SideResult,
  ) {
    if (!auditMode) return undefined;
    return {
      cell: storeOfferCell(id, label, store, {
        productId: side.productId,
        name: side.name,
        image: side.image,
        price: side.shelfPrice ?? side.lineTotal,
      }),
      map: verdicts,
      onRate: rateOffer,
    };
  }

  async function copyAuditVerdicts() {
    const text = auditClipboard;
    try {
      await navigator.clipboard.writeText(text);
      setAuditCopyOpen(false);
      setAuditNotice(
        `Скопійовано ${offerVerdictPayload(verdicts).verdicts.length} оцінок. Встав у чат агента.`,
      );
    } catch {
      setAuditCopyOpen(true);
      setAuditNotice("Скопіюй текст нижче і встав у чат агента.");
    }
  }

  async function sendAuditVerdicts() {
    setAuditNotice(null);
    try {
      const res = await fetch("/api/staples/verdicts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: auditClipboard,
      });
      const data = (await res.json()) as {
        ok?: boolean;
        persisted?: boolean;
        count?: number;
        error?: string;
      };
      if (!data.ok) throw new Error(data.error ?? "verdicts failed");
      if (data.persisted) {
        setAuditNotice(
          `Збережено ${data.count ?? 0} оцінок на сервері. Скопіюй їх ще й у чат, якщо агент на Vercel.`,
        );
      } else {
        setAuditNotice(
          "Телефон/Vercel не пише файл. Натисни «Скопіювати оцінки» і встав у чат агента.",
        );
      }
    } catch (e) {
      setAuditNotice(
        e instanceof Error
          ? e.message
          : "Не вдалося надіслати. Скопіюй оцінки в чат.",
      );
    }
  }

  const searchCatalog = useMemo(
    () =>
      liveItems.map((item) => {
        const view = withVisibleOffers(item, productOf(item));
        return {
        id: item.id,
        label: item.label,
        image: item.image,
        searchHay: item.searchHay,
        queries: item.queries,
        mustIncludeAny: item.mustIncludeAny,
        mustIncludeAll: item.mustIncludeAll,
        wmPrice: enabled.has("walmart") ? view.walmartCached?.price ?? null : null,
        nfPrice: enabled.has("nofrills") ? view.noFrillsCached?.price ?? null : null,
        wcPrice: enabled.has("wholesaleclub")
          ? view.wholesaleClubCached?.price ?? null
          : null,
        mvrPrice: enabled.has("mvr") ? view.mvrCached?.price ?? null : null,
        wmWasPrice: enabled.has("walmart")
          ? saleWasPrice(view.walmartCached)
          : null,
        nfWasPrice: enabled.has("nofrills")
          ? saleWasPrice(view.noFrillsCached)
          : null,
        wcWasPrice: enabled.has("wholesaleclub")
          ? saleWasPrice(view.wholesaleClubCached)
          : null,
        mvrWasPrice: enabled.has("mvr") ? saleWasPrice(view.mvrCached) : null,
        wmOnSale: enabled.has("walmart") && isShelfSale(view.walmartCached),
        nfOnSale: enabled.has("nofrills") && isShelfSale(view.noFrillsCached),
        wcOnSale:
          enabled.has("wholesaleclub") && isShelfSale(view.wholesaleClubCached),
        mvrOnSale: enabled.has("mvr") && isShelfSale(view.mvrCached),
      };
      }),
    [liveItems, enabled, productOf],
  );

  const cacheIsOld = useMemo(() => {
    const cutoffMs = 12 * 36e5;
    const isOld = (iso: string | null) => {
      if (!iso) return false;
      const age = Date.now() - new Date(iso).getTime();
      return Number.isFinite(age) && age > cutoffMs;
    };
    return (
      isOld(catalogAt) ||
      isOld(nfCatalogAt) ||
      isOld(wcCatalogAt) ||
      isOld(mvrCatalogAt)
    );
  }, [catalogAt, nfCatalogAt, wcCatalogAt, mvrCatalogAt]);

  function toggle(id: string) {
    const item = items.find((x) => x.id === id);
    if (!item) return;
    setCart((prev) =>
      prev[id] ? removeCartItem(prev, id) : addCartItem(prev, id, productOf(item)),
    );
  }

  function pickStaple(id: string) {
    const item = items.find((x) => x.id === id);
    if (item) {
      setCart((prev) => addCartItem(prev, id, productOf(item)));
    }
    setQuery("");
    window.setTimeout(() => {
      document
        .getElementById(`staple-${id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  function setCustomAmount(id: string, value: string) {
    const item = items.find((x) => x.id === id);
    if (!item) return;
    const n = Number.parseFloat(value);
    const product = productOf(item);
    if (Number.isFinite(n) && n > 0) {
      setCart((prev) =>
        setCartCustomAmount(addCartItem(prev, id, product), id, n, product.unit),
      );
    }
  }

  function setEggCount(id: string, count: number) {
    const item = items.find((x) => x.id === id);
    if (!item || !(count > 0)) return;
    const product = productOf(item);
    setCart((prev) =>
      setCartCustomAmount(addCartItem(prev, id, product), id, count, "ea"),
    );
  }

  function persistOverrides(next: Record<string, ProductOverride>) {
    const saved = writeProductOverrides(next);
    setOverrides(saved);
  }

  async function saveProductSettings(
    item: Staple,
    override: ProductOverride,
    matchModeChanged: boolean,
    rematch: boolean,
  ) {
    const prev = productOf(item);
    const nextOverride: ProductOverride = {
      ...overrides[item.id],
      ...override,
      matchMode: stapleForcesExactMatch(item) ? "exact" : override.matchMode,
      needsReview: matchModeChanged ? true : overrides[item.id]?.needsReview,
    };
    if (matchModeChanged) nextOverride.needsReview = true;
    const nextOverrides = { ...overrides, [item.id]: nextOverride };
    persistOverrides(nextOverrides);
    setCart((c) => {
      const e = c[item.id];
      if (!e || e.isCustom) return c;
      return {
        ...c,
        [item.id]: {
          requestedAmount: nextOverride.defaultAmount ?? prev.defaultAmount,
          unit: (nextOverride.unit as AmountUnit) ?? prev.unit,
          isCustom: false,
        },
      };
    });
    try {
      await fetch("/api/staples/product-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          override: nextOverride,
          previousMatchMode: prev.matchMode,
          allOverrides: nextOverrides,
        }),
      });
    } catch {
      /* Vercel FS may be read-only; localStorage is the live store. */
    }
    if (rematch) {
      rematchItems([item.id], nextOverrides);
      return;
    }
  }

  function rematchItems(
    ids: string[],
    overrideMap: Record<string, ProductOverride> = overrides,
  ) {
    if (!ids.length) return;
    setError(null);
    setBusy("rematch");
    startTransition(async () => {
      try {
        const res = await fetch("/api/staples/rematch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ids,
            productOverrides: overrideMap,
            customStaples: readCustomStaples(),
          }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error ?? "rematch failed");
        setMatchLogId(data.matchLogId ?? null);
        setLogPreview(data);
        await reload();
        const wmN = data.walmart?.updated?.length ?? 0;
        const nfN = data.noFrills?.updated?.length ?? 0;
        const wcN = data.wholesaleClub?.updated?.length ?? 0;
        const mvrN = data.mvr?.updated?.length ?? 0;
        if (data.walmartSkipped) {
          setError(
            `Товар оновлено без Walmart (немає RapidAPI ключа). NF ${nfN}${
              wcN ? ` · WC ${wcN}` : ""
            }${mvrN ? ` · MVR ${mvrN}` : ""}.`,
          );
        } else if (data.walmart?.error) {
          setError(
            `Walmart: ${String(data.walmart.error).slice(0, 140)}. Інші магазини: NF ${nfN}, WC ${wcN}, MVR ${mvrN}.`,
          );
        } else if (data.noFrills?.error || data.wholesaleClub?.error || data.mvr?.error) {
          setError(
            `Оновлено WM ${wmN}. ${
              data.noFrills?.error
                ? `NF: ${String(data.noFrills.error).slice(0, 80)}. `
                : ""
            }${
              data.wholesaleClub?.error
                ? `WC: ${String(data.wholesaleClub.error).slice(0, 80)}. `
                : ""
            }${
              data.mvr?.error
                ? `MVR: ${String(data.mvr.error).slice(0, 80)}.`
                : ""
            }`.trim(),
          );
        }
      } catch (e) {
        setError(e instanceof Error ? friendlyError(e.message) : String(e));
      } finally {
        setBusy(null);
      }
    });
  }

  async function adoptFromReceipt(drafts: ReceiptStapleDraft[], rematch: boolean) {
    setBusy("receipt");
    setError(null);
    try {
      const res = await fetch("/api/staples/receipts/adopt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          drafts,
          customStaples: readCustomStaples(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        added?: string[];
        items?: ReceiptStapleDraft[];
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "не вдалося додати продукти з чека");
      }
      const addedItems = Array.isArray(data.items) && data.items.length
        ? data.items
        : drafts;
      upsertCustomStaples(addedItems);
      const addedIds = (
        Array.isArray(data.added) && data.added.length
          ? data.added
          : addedItems.map((item) => item.id)
      ).filter(Boolean);
      persistRemoved(removedIds.filter((id) => !addedIds.includes(id)));
      setReceiptOpen(false);
      await reload();
      if (rematch && addedIds.length) {
        rematchItems(addedIds);
      }
    } catch (e) {
      setError(e instanceof Error ? friendlyError(e.message) : String(e));
    } finally {
      setBusy((cur) => (cur === "receipt" ? null : cur));
    }
  }

  function saveDefaultFromCart(item: Staple) {
    const entry = cart[item.id];
    if (!entry) return;
    const next = {
      ...overrides,
      [item.id]: {
        ...overrides[item.id],
        defaultAmount: entry.requestedAmount,
        unit: entry.unit as AmountUnit,
      },
    };
    persistOverrides(next);
    void fetch("/api/staples/product-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: item.id,
        override: next[item.id],
        allOverrides: next,
      }),
    }).catch(() => {});
    setCart((c) => ({
      ...c,
      [item.id]: {
        requestedAmount: entry.requestedAmount,
        unit: entry.unit,
        isCustom: false,
      },
    }));
  }

  const allVisibleSelected =
    visibleItems.length > 0 &&
    visibleItems.every((item) => selected.has(item.id));

  function selectAllVisible() {
    setCart((prev) => {
      let next = { ...prev };
      for (const item of visibleItems) {
        if (!next[item.id]) next = addCartItem(next, item.id, productOf(item));
      }
      return next;
    });
  }

  function clearVisibleSelection() {
    const ids = new Set(visibleItems.map((item) => item.id));
    setCart((prev) => {
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });
  }

  function clearEntireCart() {
    setCart(clearCart());
  }

  function persistRemoved(ids: string[]) {
    const next = writeRemovedStapleIds(ids);
    setRemovedIds(next);
  }

  function deleteStaples(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return;
    const labels = unique
      .map((id) => liveItems.find((item) => item.id === id)?.label ?? id)
      .slice(0, 4);
    const extra = unique.length > 4 ? ` (+${unique.length - 4})` : "";
    const ok = window.confirm(
      unique.length === 1
        ? `Видалити «${labels[0]}» з кафе?`
        : `Видалити ${unique.length} продукти: ${labels.join(", ")}${extra}?`,
    );
    if (!ok) return;
    const extras = readCustomStaples();
    persistRemoved([...removedIds, ...unique]);
    dropCustomStaples(unique);
    setCart((prev) => {
      const next = { ...prev };
      for (const id of unique) delete next[id];
      return next;
    });
    setSettingsId((cur) => (cur && unique.includes(cur) ? null : cur));
    setBusy("delete");
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/staples/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ids: unique,
            customStaples: extras,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          throw new Error(data.error ?? "delete failed");
        }
      } catch (e) {
        setError(e instanceof Error ? friendlyError(e.message) : String(e));
      } finally {
        setBusy(null);
      }
    });
  }

  function runCompare() {
    setError(null);
    setBusy("compare");
    startTransition(async () => {
      try {
        const res = await fetch("/api/staples/compare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ids: [...selected],
            cart,
            productOverrides: overrides,
            customStaples: readCustomStaples(),
            grams: Object.fromEntries(
              Object.entries(cart).map(([id, e]) => {
                const base = toBase(e.requestedAmount, e.unit as AmountUnit);
                return [id, base.unit === "g" ? base.amount : 0];
              }),
            ),
            qty: Object.fromEntries(
              Object.entries(cart)
                .filter(([, e]) => e.unit === "pack" || e.unit === "ea")
                .map(([id, e]) => [id, Math.max(1, Math.round(e.requestedAmount))]),
            ),
          }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error ?? "compare failed");
        setRows(data.rows);
        setTotals(data.totals);
        setMatchLogId(data.matchLogId ?? null);
        setLogPreview(null);
        applyStats(data.stats);
        if (typeof data.savedRunId === "string") setOpenRunId(data.savedRunId);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? friendlyError(e.message) : String(e));
      } finally {
        setBusy(null);
      }
    });
  }

  function refreshSelected() {
    setError(null);
    setBusy("refresh");
    startTransition(async () => {
      try {
        const res = await fetch("/api/staples/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ids: [...selected],
            customStaples: readCustomStaples(),
          }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error ?? "refresh failed");
        setMatchLogId(data.matchLogId ?? null);
        setLogPreview(data.entries ?? null);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? friendlyError(e.message) : String(e));
      } finally {
        setBusy(null);
      }
    });
  }

  function refreshNoFrillsSelected() {
    setError(null);
    setBusy("refresh-nf");
    startTransition(async () => {
      try {
        const res = await fetch("/api/staples/refresh-nf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ids: [...selected],
            customStaples: readCustomStaples(),
          }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error ?? "NF refresh failed");
        setMatchLogId(data.matchLogId ?? null);
        setLogPreview(data.entries ?? null);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? friendlyError(e.message) : String(e));
      } finally {
        setBusy(null);
      }
    });
  }

  function refreshWholesaleClubSelected() {
    setError(null);
    setBusy("refresh-wc");
    startTransition(async () => {
      try {
        const res = await fetch("/api/staples/refresh-wc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ids: [...selected],
            customStaples: readCustomStaples(),
          }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error ?? "WC refresh failed");
        setMatchLogId(data.matchLogId ?? null);
        setLogPreview(data.entries ?? null);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? friendlyError(e.message) : String(e));
      } finally {
        setBusy(null);
      }
    });
  }

  function refreshMvrSelected() {
    setError(null);
    setBusy("refresh-mvr");
    startTransition(async () => {
      try {
        const res = await fetch("/api/staples/refresh-mvr", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ids: [...selected],
            customStaples: readCustomStaples(),
          }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error ?? "MVR refresh failed");
        setMatchLogId(data.matchLogId ?? null);
        setLogPreview(data.entries ?? null);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? friendlyError(e.message) : String(e));
      } finally {
        setBusy(null);
      }
    });
  }

  function refreshSobeysSelected() {
    setError(null);
    setBusy("refresh-sobeys");
    startTransition(async () => {
      try {
        const res = await fetch("/api/staples/refresh-sobeys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ids: [...selected],
            customStaples: readCustomStaples(),
          }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error ?? "Sobeys flyer refresh failed");
        setMatchLogId(data.matchLogId ?? null);
        setLogPreview(data.entries ?? null);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? friendlyError(e.message) : String(e));
      } finally {
        setBusy(null);
      }
    });
  }

  function refreshAllPrices() {
    const ids = visibleItems.map((item) => item.id);
    if (!ids.length) return;
    setError(null);
    setBusy("refresh-prices");
    startTransition(async () => {
      try {
        const res = await fetch("/api/staples/refresh-prices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ids,
            customStaples: readCustomStaples(),
          }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error ?? "price refresh failed");
        const wmN = data.walmart?.updated?.length ?? 0;
        const nfN = data.noFrills?.updated?.length ?? 0;
        const wcN = data.wholesaleClub?.updated?.length ?? 0;
        const mvrN = data.mvr?.updated?.length ?? 0;
        const nfBlock = data.noFrills?.blocked as string | undefined;
        const wcBlock = data.wholesaleClub?.blocked as string | undefined;
        const mvrBlock = data.mvr?.blocked as string | undefined;
        setLogPreview(data);
        await reload();
        if (data.walmartSource === "missing_key") {
          setError(
            `No Frills ${nfN ? `оновлено ${nfN}` : "без змін"}${
              wcN ? ` · WC ${wcN}` : ""
            }${mvrN ? ` · MVR ${mvrN}` : ""}. RapidAPI ключ порожній — ціни WM не чіпали.`,
          );
        } else if (nfBlock) {
          setError(
            `WM оновлено ${wmN}. No Frills зараз недоступний з цього сервера (401) — NF кеш не змінювався.`,
          );
        } else if (wcBlock) {
          setError(
            `WM ${wmN}, NF ${nfN}. Wholesale Club недоступний з цього сервера — WC кеш не змінювався.`,
          );
        } else if (mvrBlock) {
          setError(
            `WM ${wmN}, NF ${nfN}, WC ${wcN}. MVR недоступний з цього сервера — MVR кеш не змінювався.`,
          );
        } else if (wmN === 0 && nfN === 0 && wcN === 0 && mvrN === 0) {
          setError("Жодної ціни не вдалося оновити.");
        }
      } catch (e) {
        setError(e instanceof Error ? friendlyError(e.message) : String(e));
      } finally {
        setBusy(null);
      }
    });
  }

  async function vote(
    id: string,
    vote: "up" | "down",
    productId?: string,
    e?: { stopPropagation(): void },
  ) {
    e?.stopPropagation();
    setError(null);
    try {
      const res = await fetch("/api/staples/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, vote, productId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "confirm failed");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const displayRows = useMemo(() => {
    if (!rows) return null;
    return rows.map((row) => {
      const next = cheaperAmongStores(
        {
          walmart: sideLineTotal(row.walmart),
          nofrills: sideLineTotal(row.noFrills),
          wholesaleclub: sideLineTotal(row.wholesaleClub),
          mvr: sideLineTotal(row.mvr),
        },
        enabled,
      );
      return { ...row, cheaper: next.cheaper, delta: next.delta };
    });
  }, [rows, enabled]);

  const displayTotals = useMemo(() => {
    if (!totals) return null;
    const coverageOf: Record<
      CompareStoreId,
      CompareTotals["walmartComplete"]
    > = {
      walmart: totals.walmartComplete,
      nofrills: totals.noFrillsComplete,
      wholesaleclub: totals.wholesaleClubComplete,
      mvr: totals.mvrComplete,
    };
    const winnerStores = COMPARE_STORES.filter((s) => enabled.has(s.id))
      .map((s) => {
        const coverage = coverageOf[s.id];
        if (!coverage) return null;
        return {
          id: s.id,
          coverage: {
            requestedItems: coverage.requestedItems,
            availableComparableItems: coverage.availableComparableItems,
            checkoutTotal: coverage.checkoutTotal,
            complete: coverage.complete,
            coverage: coverage.coverage ?? "",
          },
        };
      })
      .filter(
        (row): row is NonNullable<typeof row> => row != null,
      );
    const enabledMissing = new Set(
      COMPARE_STORES.filter((s) => enabled.has(s.id)).map(
        (s) => STORE_MISSING_LABEL[s.id],
      ),
    );
    const incompleteItems = (totals.incompleteItems ?? [])
      .map((it) => ({
        ...it,
        missing: it.missing.filter((name) => enabledMissing.has(name)),
      }))
      .filter((it) => it.missing.length > 0);
    return {
      ...totals,
      cheaper: completeBasketWinner(winnerStores),
      incompleteItems,
    };
  }, [totals, enabled]);

  const purchasePlans = useMemo(() => {
    if (!displayRows?.length) return [];
    return recommendPurchasePlans(linesFromBasketRows(displayRows), enabled);
  }, [displayRows, enabled]);

  const compareLine = COMPARE_STORES.filter((s) => isOn(s.id))
    .map((s) =>
      s.id === "mvr" ? `${s.label} Cash & Carry (${s.detail})` : `${s.label} ${s.detail}`,
    )
    .join(" vs ");

  return (
    <div className="staples">
      <header className="hero">
        <p className="brand">Royal SASS</p>
        <h1>Cafe staples</h1>
        <p className="sub">
          {compareLine || "Оберіть магазини зверху"}. <strong>А</strong> — точний
          продукт. <strong>Б</strong> — найдешевший відповідний (бренд не
          важливий). Кількість за замовчуванням береться з картки; зміна в
          кошику не змінює дефолт, поки не натиснеш «Зберегти як новий дефолт».
        </p>
        <p
          className={
            cacheIsOld || walmartSource === "missing_key" || walmartSource === "browser"
              ? "meta cache-warn"
              : "meta"
          }
        >
          Cache TTL {staleHours}h
          {walmartSourceLabel(walmartSource)
            ? ` · ${walmartSourceLabel(walmartSource)}`
            : ""}
          {catalogAt
            ? ` · WM ${new Date(catalogAt).toLocaleString()}`
            : ""}
          {nfCatalogAt
            ? ` · NF ${new Date(nfCatalogAt).toLocaleString()}`
            : " · NF — після першого Compare"}
          {wcCatalogAt
            ? ` · WC ${new Date(wcCatalogAt).toLocaleString()}`
            : " · WC — Refresh WC або Compare"}
          {mvrCatalogAt
            ? ` · MVR ${new Date(mvrCatalogAt).toLocaleString()}`
            : " · MVR — Refresh MVR або Compare"}
          {sobeysCatalogAt
            ? ` · Sobeys флаєр ${new Date(sobeysCatalogAt).toLocaleString()}`
            : ""}
          {cacheIsOld
            ? " · кеш застарів — натисни «Оновити ціни» або «Оновити» на картці"
            : ""}
          {walmartSource === "missing_key" && walmartSourceWarning
            ? " · додай RapidAPI ключ у .env / Vercel"
            : ""}
          {statsSummary?.runCount
            ? ` · статистика: ${statsSummary.runCount} порівнянь`
            : " · кожне Compare зберігається в статистику"}
        </p>
        <ProductSearch
          query={query}
          onQueryChange={setQuery}
          onPickStaple={pickStaple}
          catalogReady={catalogReady}
          catalog={searchCatalog}
        />
        <div className="audit-bar">
          <button
            type="button"
            className={auditMode ? "audit-toggle on" : "audit-toggle"}
            aria-pressed={auditMode}
            onClick={() => {
              setAuditMode((on) => !on);
              setAuditNotice(null);
            }}
          >
            {auditMode ? "Оцінка підбору · увімкнено" : "Оцінити фото: так / ні"}
          </button>
          {auditMode && (
            <>
              <p className="audit-hint">
                Так = правильний товар (або правильно, що порожньо). Ні =
                підміна. Не здогадуємось SKU. Це не 👍 замок. Оцінено{" "}
                {auditProgress.rated} з {auditProgress.total}
                {auditProgress.no ? ` · ні ${auditProgress.no}` : ""}
                {auditProgress.unrated ? ` · ще ${auditProgress.unrated}` : ""}.
              </p>
              <div className="audit-filters">
                {(
                  [
                    ["unrated", "Не оцінені"],
                    ["no", "Лише ні"],
                    ["all", "Усі картки"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={auditFilter === id ? "qty-btn egg-on" : "qty-btn"}
                    onClick={() => setAuditFilter(id)}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  className="cta secondary"
                  disabled={!auditProgress.rated}
                  onClick={() => void copyAuditVerdicts()}
                >
                  Скопіювати оцінки
                </button>
                <button
                  type="button"
                  className="cta secondary"
                  disabled={!auditProgress.rated}
                  onClick={() => void sendAuditVerdicts()}
                >
                  Надіслати на сервер
                </button>
              </div>
              {auditNotice && <p className="audit-note">{auditNotice}</p>}
              {auditCopyOpen && (
                <textarea
                  className="audit-json"
                  readOnly
                  rows={8}
                  value={auditClipboard}
                  onFocus={(e) => e.currentTarget.select()}
                />
              )}
            </>
          )}
        </div>
      </header>

      <section className={auditMode ? "grid audit-on" : "grid"}>
        {!catalogReady &&
          Array.from({ length: 8 }).map((_, i) => (
            <div key={`sk-${i}`} className="card skeleton" aria-hidden>
              <div className="card-main">
                <div className="thumb">
                  <div className="ph" />
                </div>
                <div className="body">
                  <strong>…</strong>
                  <span className="pill">завантаження</span>
                </div>
              </div>
            </div>
          ))}
        {catalogReady && visibleItems.map((item) => {
          const on = selected.has(item.id);
          const product = productOf(item);
          const view = withVisibleOffers(item, product);
          const isCatB = product.matchMode === "cheapest_equivalent";
          const entry = cart[item.id];
          const requested = entry?.requestedAmount ?? product.defaultAmount;
          const neededBase = toBase(requested, product.unit);
          const neededG = neededBase.unit === "g" ? neededBase.amount : null;
          const cat = matchCategory(product.matchMode);
          const saleOffers = saleOffersFromPrices({
            walmart: isOn("walmart") ? view.walmartCached : null,
            nofrills: isOn("nofrills") ? view.noFrillsCached : null,
            wholesaleclub: isOn("wholesaleclub")
              ? view.wholesaleClubCached
              : null,
            mvr: isOn("mvr") ? view.mvrCached : null,
          });
          const cheaperSales = cheaperSaleOffers(saleOffers);
          const cheaperSaleAt = new Set(cheaperSales.map((row) => row.store));
          const anySale = saleOffers.some((row) => isShelfSale(row));
          const saleChip = cheaperSaleHint(saleOffers);
          const thumb =
            isCatB && view.walmartCached?.image
              ? view.walmartCached.image
              : item.image;
          return (
            <div
              key={item.id}
              id={`staple-${item.id}`}
              className={on ? "card on" : "card"}
            >
              <button
                type="button"
                className="card-main"
                onClick={() => toggle(item.id)}
              >
                {!auditMode && (
                <div className="thumb">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={thumb}
                      alt={item.label}
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="ph">No photo</div>
                  )}
                  {anySale && (
                    <span className="sale-bang" title={saleTitle(view)}>
                      {saleChip ? "%" : "З"}
                    </span>
                  )}
                </div>
                )}
                <div className="body">
                  <strong>
                    {item.label}
                    {anySale ? (
                      <span className="sale-mark" title={saleTitle(view)}>
                        {saleChip ?? "знижка"}
                      </span>
                    ) : null}
                    {on && entry?.isCustom ? (
                      <span className="qty-mark">
                        {" "}
                        {amountLabel(item, requested, product.unit)}
                      </span>
                    ) : null}
                  </strong>
                  <span className={`pill ${item.status}`}>
                    {statusLabel(item.status)}
                  </span>
                  <span className={`pill cat-${cat.key}`} title={cat.title}>
                    {cat.short}
                  </span>
                  {isOn("walmart") &&
                    (view.walmartCached ? (
                    <>
                      <span className="sku">
                        WM {tidyOfferName(view.walmartCached.name)}
                      </span>
                      {storePriceLine("WM", view.walmartCached, {
                        cheaperSale: cheaperSaleAt.has("walmart"),
                      })}
                      {item.weightCompare &&
                        view.walmartCached.nativeUnitPriceLabel && (
                          <span className="unitprice">
                            {view.walmartCached.nativeUnitPriceLabel}
                          </span>
                        )}
                    </>
                  ) : (
                    <span className="price mute">немає WM ціни</span>
                  ))}
                  {isOn("nofrills") &&
                    (view.noFrillsCached ? (
                    <>
                      <span className="sku">
                        NF {tidyOfferName(view.noFrillsCached.name)}
                      </span>
                      {storePriceLine("NF", view.noFrillsCached, {
                        cheaperSale: cheaperSaleAt.has("nofrills"),
                      })}
                      {item.weightCompare &&
                        view.noFrillsCached.nativeUnitPriceLabel && (
                          <span className="unitprice">
                            {view.noFrillsCached.nativeUnitPriceLabel}
                          </span>
                        )}
                    </>
                  ) : (
                    <span className="price mute">немає NF ціни</span>
                  ))}
                  {isOn("wholesaleclub") &&
                    (view.wholesaleClubCached ? (
                    <>
                      <span className="sku">
                        WC {tidyOfferName(view.wholesaleClubCached.name)}
                      </span>
                      {storePriceLine("WC", view.wholesaleClubCached, {
                        cheaperSale: cheaperSaleAt.has("wholesaleclub"),
                      })}
                      {item.weightCompare &&
                        view.wholesaleClubCached.nativeUnitPriceLabel && (
                          <span className="unitprice">
                            {view.wholesaleClubCached.nativeUnitPriceLabel}
                          </span>
                        )}
                    </>
                  ) : (
                    <span className="price mute">немає WC ціни</span>
                  ))}
                  {isOn("mvr") &&
                    (view.mvrCached ? (
                    <>
                      <span className="sku">
                        MVR {tidyOfferName(view.mvrCached.name)}
                      </span>
                      {storePriceLine("MVR", view.mvrCached, {
                        cheaperSale: cheaperSaleAt.has("mvr"),
                      })}
                      {item.weightCompare &&
                        view.mvrCached.nativeUnitPriceLabel && (
                          <span className="unitprice">
                            {view.mvrCached.nativeUnitPriceLabel}
                          </span>
                        )}
                    </>
                  ) : (
                    <span className="price mute">немає MVR ціни</span>
                  ))}
                  {item.sobeysCached ? (
                    <>
                      <span className="sku">
                        Sobeys флаєр {tidyOfferName(item.sobeysCached.name)}
                      </span>
                      <span className="price mute">
                        Sobeys ~ ${item.sobeysCached.price.toFixed(2)}
                        {item.sobeysCached.packageSize
                          ? ` · ${item.sobeysCached.packageSize}`
                          : ""}
                        {" · оцінка, не полиця"}
                      </span>
                    </>
                  ) : null}
                  {isOn("walmart") && view.walmartCached && item.ageLabel && (
                    <span className="age">
                      {"WM \u0446\u0456\u043d\u0430 \u0432\u0456\u0434 "}
                      {item.ageLabel}
                    </span>
                  )}
                  {isOn("nofrills") && view.noFrillsCached?.ageLabel && (
                    <span className="age">
                      {"NF \u0446\u0456\u043d\u0430 \u0432\u0456\u0434 "}
                      {view.noFrillsCached.ageLabel}
                    </span>
                  )}
                  {isOn("wholesaleclub") && view.wholesaleClubCached?.ageLabel && (
                    <span className="age">
                      {"WC \u0446\u0456\u043d\u0430 \u0432\u0456\u0434 "}
                      {view.wholesaleClubCached.ageLabel}
                    </span>
                  )}
                  {isOn("mvr") && view.mvrCached?.ageLabel && (
                    <span className="age">
                      {"MVR \u0446\u0456\u043d\u0430 \u0432\u0456\u0434 "}
                      {view.mvrCached.ageLabel}
                    </span>
                  )}
                  {isCatB &&
                    neededG != null &&
                    (() => {
                      const wmBuy = categoryBPreview(
                        view.walmartCached,
                        neededG,
                        Boolean(item.soldByWeight),
                        item.typicalEachGrams,
                      );
                      const nfBuy = categoryBPreview(
                        view.noFrillsCached,
                        neededG,
                        Boolean(item.soldByWeight),
                        item.typicalEachGrams,
                      );
                      const wcBuy = categoryBPreview(
                        view.wholesaleClubCached ?? null,
                        neededG,
                        Boolean(item.soldByWeight),
                        item.typicalEachGrams,
                      );
                      const mvrBuy = categoryBPreview(
                        view.mvrCached ?? null,
                        neededG,
                        Boolean(item.soldByWeight),
                        item.typicalEachGrams,
                      );
                      if (!wmBuy && !nfBuy && !wcBuy && !mvrBuy) return null;
                      return (
                        <>
                          {isOn("walmart") && wmBuy && (
                            <span className="unitprice">
                              WM {formatBBuy(wmBuy)}
                            </span>
                          )}
                          {isOn("nofrills") && nfBuy && (
                            <span className="unitprice">
                              NF {formatBBuy(nfBuy)}
                            </span>
                          )}
                          {isOn("wholesaleclub") && wcBuy && (
                            <span className="unitprice">
                              WC {formatBBuy(wcBuy)}
                            </span>
                          )}
                          {isOn("mvr") && mvrBuy && (
                            <span className="unitprice">
                              MVR {formatBBuy(mvrBuy)}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  {item.statusReason && (
                    <span className="reason">{item.statusReason}</span>
                  )}
                </div>
                <span className="check">{on ? "✓" : ""}</span>
              </button>
              {auditMode && (
                <OfferAuditGrid
                  cells={auditCellsFor(item)}
                  map={verdicts}
                  onRate={rateOffer}
                />
              )}
              <div className="card-tools">
                <button
                  type="button"
                  className="settings-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSettingsId(item.id);
                  }}
                >
                  Налаштування
                </button>
                <button
                  type="button"
                  className="settings-btn"
                  disabled={pending || busy != null}
                  title="Знайти товар знову за правилами з Налаштувань (не лише ціну)"
                  onClick={(e) => {
                    e.stopPropagation();
                    rematchItems([item.id]);
                  }}
                >
                  {busy === "rematch" ? "Оновлюю…" : "Оновити"}
                </button>
                <button
                  type="button"
                  className="settings-btn danger"
                  disabled={pending || busy != null}
                  title="Прибрати цю картку з кафе"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteStaples([item.id]);
                  }}
                >
                  {busy === "delete" ? "Видаляю…" : "Видалити"}
                </button>
                <div className="qty-row">
                  <span>
                    Зазвичай: {amountLabel(item, product.defaultAmount, product.unit)}
                  </span>
                  {isEggPackStaple(item) && (
                    <div className="egg-picks">
                      <span>Скільки яєць</span>
                      {(item.eggCountChoices?.length
                        ? item.eggCountChoices
                        : EGG_COUNT_PRESETS
                      ).map((n) => (
                        <button
                          key={n}
                          type="button"
                          className={
                            requested === n ? "qty-btn egg-on" : "qty-btn"
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            setEggCount(item.id, n);
                          }}
                        >
                          {n}
                          {item.largestEggPack === n ? " · найбільша" : ""}
                        </button>
                      ))}
                    </div>
                  )}
                  {on && (
                    <>
                      <button
                        type="button"
                        className="qty-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setQtyOpenId((id) => (id === item.id ? null : item.id));
                        }}
                      >
                        Змінити кількість
                      </button>
                      {qtyOpenId === item.id && (
                        <label className="grams">
                          <span>для цього кошика</span>
                          <input
                            type="number"
                            min={0.01}
                            step="any"
                            inputMode="decimal"
                            value={entry?.requestedAmount ?? product.defaultAmount}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              setCustomAmount(item.id, e.target.value)
                            }
                          />
                          <span className="qty-unit">
                            {isEggPackStaple(item) ? "яєць" : product.unit}
                          </span>
                          {entry?.isCustom && (
                            <button
                              type="button"
                              className="qty-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                saveDefaultFromCart(item);
                              }}
                            >
                              Зберегти як новий дефолт
                            </button>
                          )}
                        </label>
                      )}
                    </>
                  )}
                </div>
              </div>
              {!auditMode && (
              <div className="votes">
                <button
                  type="button"
                  title="Підтвердити матч"
                  onClick={(e) =>
                    vote(item.id, "up", view.walmartCached?.productId, e)
                  }
                >
                  👍{item.confirmed ? "✓" : ""}
                </button>
                <button
                  type="button"
                  title="Відхилити матч"
                  onClick={(e) => vote(item.id, "down", undefined, e)}
                >
                  👎
                </button>
              </div>
              )}
            </div>
          );
        })}
        {catalogReady && visibleItems.length === 0 && (
          <p className="empty-grid">
            {query.trim()
              ? "У списку немає такого продукту"
              : auditMode && auditFilter === "unrated"
                ? "Усі видимі фото вже оцінені."
                : auditMode && auditFilter === "no"
                  ? "Немає оцінок «ні»."
                  : "Немає карток."}
          </p>
        )}
      </section>

      {settingsId &&
        (() => {
          const item = items.find((x) => x.id === settingsId);
          if (!item) return null;
          const product = productOf(item);
          const view = withVisibleOffers(item, product);
          return (
            <ProductSettings
              product={product}
              open
              onClose={() => setSettingsId(null)}
              onSave={(ov, changed, rematch) => {
                void saveProductSettings(item, ov, changed, rematch);
              }}
              confirmedStoreProducts={
                overrides[item.id]?.confirmedStoreProducts
              }
              storeOffers={[
                {
                  retailer: "walmart_ca",
                  label: "Walmart",
                  productId: view.walmartCached?.productId,
                  name: view.walmartCached?.name,
                },
                {
                  retailer: "no_frills",
                  label: "No Frills",
                  productId: view.noFrillsCached?.productId,
                  name: view.noFrillsCached?.name,
                },
                {
                  retailer: "wholesale_club",
                  label: "Wholesale Club",
                  productId: view.wholesaleClubCached?.productId,
                  name: view.wholesaleClubCached?.name,
                },
                {
                  retailer: "mvr",
                  label: "MVR",
                  productId: view.mvrCached?.productId,
                  name: view.mvrCached?.name,
                },
              ]}
            />
          );
        })()}

      <ReceiptUpload
        open={receiptOpen}
        busy={busy != null}
        onClose={() => setReceiptOpen(false)}
        onAdopt={adoptFromReceipt}
      />

      {showCart && (
        <div className="cart-drawer">
          <header>
            <strong>Кошик · {cartSize(cart)} товарів</strong>
            <button type="button" onClick={() => setShowCart(false)}>
              Закрити
            </button>
          </header>
          <ul>
            {Object.keys(cart).map((id) => {
              const item = items.find((x) => x.id === id);
              const e = cart[id]!;
              return (
                <li key={id}>
                  <span>
                    {item?.label ?? id} · {amountLabel(item ?? { id }, e.requestedAmount, e.unit)}
                    {e.isCustom ? " (змінено)" : ""}
                  </span>
                  <button type="button" onClick={() => toggle(id)}>
                    Прибрати
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="cart-bar">
        <span>{cartSize(cart)} товарів</span>
        <button type="button" onClick={() => setShowCart(true)}>
          Переглянути кошик
        </button>
        <button
          type="button"
          disabled={cartSize(cart) === 0}
          onClick={clearEntireCart}
        >
          Очистити кошик
        </button>
        <button
          type="button"
          className="cta"
          disabled={pending || cartSize(cart) === 0 || busy != null}
          onClick={runCompare}
        >
          {busy === "compare" ? "Comparing…" : "Порівняти"}
        </button>
      </div>

      <div className="actions">
        <button
          type="button"
          className="cta secondary"
          disabled={pending || busy != null}
          title="Фото або текст чека — нові продукти додаються картками"
          onClick={() => setReceiptOpen(true)}
        >
          {busy === "receipt" ? "Чек…" : "Чек"}
        </button>
        <button
          type="button"
          className="cta secondary"
          disabled={pending || visibleItems.length === 0 || busy != null}
          onClick={allVisibleSelected ? clearVisibleSelection : selectAllVisible}
        >
          {allVisibleSelected
            ? "Зняти видимі"
            : `Виділити видимі (${visibleItems.length})`}
        </button>
        <button
          type="button"
          className="cta"
          disabled={pending || visibleItems.length === 0 || busy != null}
          onClick={refreshAllPrices}
        >
          {busy === "refresh-prices"
            ? "Оновлюю ціни…"
            : "Оновити ціни"}
        </button>
        <button
          type="button"
          className="cta secondary"
          disabled={pending || cartSize(cart) === 0 || busy != null}
          title="Знайти вибрані товари знову за правилами з Налаштувань"
          onClick={() => rematchItems([...selected])}
        >
          {busy === "rematch" ? "Шукаю товари…" : "Оновити вибрані"}
        </button>
        <button
          type="button"
          className="cta secondary danger"
          disabled={pending || cartSize(cart) === 0 || busy != null}
          title="Прибрати вибрані картки з кафе"
          onClick={() => deleteStaples([...selected])}
        >
          {busy === "delete" ? "Видаляю…" : "Видалити вибрані"}
        </button>
      </div>

      {error && <p className="err">{error}</p>}

      {displayRows && (
        <section className="results">
          <h2>Results</h2>
          {displayRows.map((r) => (
            <article key={r.id} className="row">
              <div className="row-head">
                {r.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.image}
                    alt=""
                    className="mini"
                    referrerPolicy="no-referrer"
                  />
                )}
                <div>
                  <strong>
                    {r.label}
                    {r.confirmed ? " · locked" : ""}
                    {r.requestedAmount != null
                      ? ` · треба ${
                          isEggPackStaple({ id: r.id })
                            ? ukEggCountLabel(r.requestedAmount)
                            : `${r.requestedAmount} ${r.requestedUnit ?? ""}`
                        }`
                      : r.grams
                        ? ` · ${r.grams} g`
                        : r.qty != null && r.qty > 1
                          ? ` · ×${r.qty}`
                          : ""}
                  </strong>
                  <div className="badge">
                    {storeCount < 2
                      ? "Оберіть ще магазин зверху"
                      : r.cheaper === "incomplete" && r.fairBasis === "incomparable"
                      ? "Incomparable"
                      : cheaperLabel(r.cheaper)}
                    {r.delta != null && r.cheaper !== "tie" && storeCount >= 2
                      ? ` · Δ $${Math.abs(r.delta).toFixed(2)}`
                      : ""}
                    {r.fairLabel ? ` · ${r.fairLabel}` : ""}
                  </div>
                </div>
              </div>
              <div
                className="cols"
                style={{
                  gridTemplateColumns: `repeat(${Math.max(storeCount, 1)}, minmax(0, 1fr))`,
                }}
              >
                {isOn("walmart") && (
                <Side
                  title="Walmart"
                  side={r.walmart}
                  grams={r.grams}
                  qty={r.qty}
                  cheaperSale={compareSideCheaperSale(r.cheaper, "walmart", r.walmart)}
                  audit={sideAudit(r.id, r.label, "walmart", r.walmart)}
                />
                )}
                {isOn("nofrills") && (
                <Side
                  title="No Frills"
                  side={r.noFrills}
                  grams={r.grams}
                  qty={r.qty}
                  cheaperSale={compareSideCheaperSale(r.cheaper, "nofrills", r.noFrills)}
                  audit={sideAudit(r.id, r.label, "nofrills", r.noFrills)}
                />
                )}
                {isOn("wholesaleclub") && (
                <Side
                  title="Wholesale Club"
                  side={r.wholesaleClub ?? { lineTotal: null, status: "no_match" }}
                  grams={r.grams}
                  qty={r.qty}
                  cheaperSale={compareSideCheaperSale(
                    r.cheaper,
                    "wholesaleclub",
                    r.wholesaleClub ?? { lineTotal: null, status: "no_match" },
                  )}
                  audit={sideAudit(
                    r.id,
                    r.label,
                    "wholesaleclub",
                    r.wholesaleClub ?? { lineTotal: null, status: "no_match" },
                  )}
                />
                )}
                {isOn("mvr") && (
                <Side
                  title="MVR Cash & Carry"
                  side={r.mvr ?? { lineTotal: null, status: "no_match" }}
                  grams={r.grams}
                  qty={r.qty}
                  cheaperSale={compareSideCheaperSale(
                    r.cheaper,
                    "mvr",
                    r.mvr ?? { lineTotal: null, status: "no_match" },
                  )}
                  audit={sideAudit(
                    r.id,
                    r.label,
                    "mvr",
                    r.mvr ?? { lineTotal: null, status: "no_match" },
                  )}
                />
                )}
              </div>
            </article>
          ))}

          {displayTotals && (
            <div className="totals">
              {isOn("walmart") && (
              <div>
                Walmart:{" "}
                <strong>
                  {money(displayTotals.walmartComplete?.checkoutTotal)}
                </strong>
                {displayTotals.walmartComplete?.coverage
                  ? ` · ${displayTotals.walmartComplete.coverage}`
                  : ""}
              </div>
              )}
              {isOn("nofrills") && (
              <div>
                No Frills:{" "}
                <strong>
                  {money(displayTotals.noFrillsComplete?.checkoutTotal)}
                </strong>
                {displayTotals.noFrillsComplete?.coverage
                  ? ` · ${displayTotals.noFrillsComplete.coverage}`
                  : ""}
              </div>
              )}
              {isOn("wholesaleclub") && (
              <div>
                Wholesale Club:{" "}
                <strong>
                  {money(displayTotals.wholesaleClubComplete?.checkoutTotal)}
                </strong>
                {displayTotals.wholesaleClubComplete?.coverage
                  ? ` · ${displayTotals.wholesaleClubComplete.coverage}`
                  : ""}
              </div>
              )}
              {isOn("mvr") && (
              <div>
                MVR:{" "}
                <strong>{money(displayTotals.mvrComplete?.checkoutTotal)}</strong>
                {displayTotals.mvrComplete?.coverage
                  ? ` · ${displayTotals.mvrComplete.coverage}`
                  : ""}
              </div>
              )}
              <div className="winner">
                {storeCount < 2
                  ? "Оберіть ще магазин зверху, щоб порівняти кошик"
                  : displayTotals.cheaper === "incomplete"
                  ? "Жоден магазин не закриває весь список сам"
                  : displayTotals.cheaper === "walmart"
                    ? "Найдешевший один магазин: Walmart"
                    : displayTotals.cheaper === "nofrills"
                      ? "Найдешевший один магазин: No Frills"
                      : displayTotals.cheaper === "wholesaleclub"
                        ? "Найдешевший один магазин: Wholesale Club"
                        : displayTotals.cheaper === "mvr"
                          ? "Найдешевший один магазин: MVR"
                          : "Один магазин: нічия"}
              </div>
              {purchasePlans.length > 0 && storeCount >= 2 && (
                <div className="plans">
                  <h3>Як закупити</h3>
                  <p className="tiny mute">
                    Кілька варіантів: один заїзд, або поділ між двома магазинами,
                    якщо так дешевше чи треба закрити відсутні позиції. Не
                    розкидаємо по одному товару в кожному з чотирьох.
                  </p>
                  {purchasePlans.map((plan) => (
                    <article
                      key={plan.id}
                      className={plan.recommended ? "plan rec" : "plan"}
                    >
                      <div className="plan-head">
                        {plan.recommended ? (
                          <span className="plan-badge">Рекомендовано</span>
                        ) : (
                          <span className="plan-badge alt">Варіант</span>
                        )}
                        <strong>{planHeadline(plan)}</strong>
                        <span>
                          {money(plan.total)}
                          {` · ${plan.coverage}`}
                          {plan.complete ? "" : " · неповний"}
                        </span>
                      </div>
                      {plan.kind === "split_cheaper" &&
                        plan.savingsVsBestOneStore != null &&
                        plan.savingsVsBestOneStore > 0 && (
                          <div className="tiny">
                            дешевше на ${plan.savingsVsBestOneStore.toFixed(2)} ніж
                            купити все в одному найдешевшому магазині
                          </div>
                        )}
                      {plan.kind === "split_fill" && (
                        <div className="tiny">
                          {plan.complete
                            ? "один магазин не має всіх позицій — цей поділ закриває список"
                            : "набрано максимум без чотирьох заїздів"}
                        </div>
                      )}
                      {plan.stops.map((stop) => (
                        <div key={stop.store} className="tiny plan-stop">
                          {storePlanShort(stop.store)} · {stop.itemCount}{" "}
                          {stop.itemCount === 1 ? "товар" : "товарів"} · $
                          {stop.subtotal.toFixed(2)}
                          {stop.labels.length
                            ? ` — ${planStopItems(stop.labels)}`
                            : ""}
                        </div>
                      ))}
                      {plan.missingLabels.length > 0 && (
                        <div className="tiny mute">
                          немає в цьому наборі: {plan.missingLabels.join(", ")}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
              {displayTotals.incompleteItems && displayTotals.incompleteItems.length > 0 && (
                <div className="tiny">
                  Неповні:{" "}
                  {displayTotals.incompleteItems
                    .map((it) => `${it.label} (${it.missing.join(", ")})`)
                    .join(" · ")}
                </div>
              )}
              {storeCount === 4 && displayTotals.note && (
                <div className="tiny mute">{displayTotals.note}</div>
              )}
            </div>
          )}
          <p className="meta">Збережено в статистику порівнянь</p>
        </section>
      )}

      <section className="stats">
        <h2>Статистика порівнянь</h2>
        {!statsSummary || statsSummary.runCount === 0 ? (
          <p className="meta">
            Ще немає збережених порівнянь. Натисни Compare — кошик, товари й
            хто дешевший залишаться тут після оновлення сторінки.
          </p>
        ) : (
          <>
            <p className="meta">
              {statsSummary.runCount} порівнянь · {statsSummary.itemCompares}{" "}
              позицій · {statsSummary.uniqueItems} унікальних товарів
              {statsSummary.lastComparedAt
                ? ` · останнє ${torontoWhen(statsSummary.lastComparedAt)}`
                : ""}
            </p>
            <div className="stats-wins">
              <span>Хто частіше дешевший (кошик):</span>
              <strong>{winLine(statsSummary.basketWins) || "—"}</strong>
            </div>
            {statsSummary.topItems.length > 0 && (
              <div className="stats-top">
                <h3>Товари, які порівнювали найчастіше</h3>
                <ul>
                  {statsSummary.topItems.slice(0, 12).map((item) => (
                    <li key={item.id}>
                      <span>{item.label}</span>
                      <span className="mute">
                        {item.times}× · {winLine(item.wins)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="stats-runs">
              <h3>Останні порівняння</h3>
              {statsRuns.map((run) => {
                const open = openRunId === run.id;
                return (
                  <article key={run.id} className={open ? "stat-run open" : "stat-run"}>
                    <button
                      type="button"
                      className="stat-run-head"
                      onClick={() =>
                        setOpenRunId(open ? null : run.id)
                      }
                    >
                      <span>
                        {torontoWhen(run.comparedAt)} · {run.itemCount} товарів
                      </span>
                      <span>
                        {storeShort(run.totals.cheaper)}
                        {" · WM "}
                        {moneyBasket(run.totals.walmart)}
                        {" · NF "}
                        {moneyBasket(run.totals.noFrills)}
                        {" · WC "}
                        {moneyBasket(run.totals.wholesaleClub)}
                        {" · MVR "}
                        {moneyBasket(run.totals.mvr)}
                      </span>
                    </button>
                    {open && (
                      <ul className="stat-run-items">
                        {run.items.map((item) => (
                          <li key={item.id}>
                            <strong>
                              {item.label}
                              {item.grams
                                ? ` · ${item.grams} g`
                                : item.qty > 1
                                  ? ` · ×${item.qty}`
                                  : ""}
                            </strong>
                            <span>
                              {storeShort(item.cheaper)}
                              {item.delta != null && item.cheaper !== "tie"
                                ? ` · Δ $${Math.abs(item.delta).toFixed(2)}`
                                : ""}
                            </span>
                            <span className="mute">
                              WM {money(item.walmart)} · NF {money(item.noFrills)}{" "}
                              · WC {money(item.wholesaleClub)} · MVR{" "}
                              {money(item.mvr)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>

      <style jsx>{`
        .staples {
          font-family: "Segoe UI", "Candara", "Gill Sans", sans-serif;
          color: #1c1914;
          max-width: 1280px;
          margin: 0 auto;
          padding: 1.5rem 1rem 3rem;
        }
        .hero {
          padding: 1.25rem 0 1.5rem;
        }
        .brand {
          margin: 0;
          font-size: 0.75rem;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          font-weight: 700;
          color: #2f4a3a;
        }
        h1 {
          margin: 0.35rem 0 0.4rem;
          font-size: clamp(1.8rem, 4vw, 2.4rem);
          font-family: Georgia, "Iowan Old Style", serif;
          font-weight: 600;
        }
        .sub {
          margin: 0;
          opacity: 0.8;
          max-width: 40rem;
        }
        .meta {
          margin: 0.5rem 0 0;
          font-size: 0.8rem;
          opacity: 0.55;
        }
        .meta.cache-warn {
          opacity: 1;
          color: #8a3b1a;
          font-weight: 600;
        }
        .empty-grid {
          grid-column: 1 / -1;
          margin: 0.5rem 0 0;
          font-size: 0.9rem;
          opacity: 0.7;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
          gap: 0.75rem;
        }
        .grid.audit-on {
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        }
        .audit-bar {
          margin-top: 0.85rem;
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
          align-items: flex-start;
        }
        .audit-toggle {
          border: 1px solid rgba(47, 74, 58, 0.35);
          background: #fff;
          color: #2f4a3a;
          font: inherit;
          font-weight: 750;
          padding: 0.42rem 0.85rem;
          cursor: pointer;
        }
        .audit-toggle.on {
          background: #2f4a3a;
          color: #f7f3ec;
          border-color: #2f4a3a;
        }
        .audit-hint,
        .audit-note {
          margin: 0;
          font-size: 0.82rem;
          line-height: 1.35;
          max-width: 42rem;
        }
        .audit-note {
          color: #7a4a32;
          font-weight: 650;
        }
        .audit-filters {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
          align-items: center;
        }
        .audit-json {
          width: 100%;
          max-width: 42rem;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.72rem;
          padding: 0.5rem;
          border: 1px solid rgba(40, 50, 40, 0.2);
          background: #fffdf8;
        }
        .card {
          border: 1px solid rgba(40, 50, 40, 0.15);
          background: rgba(255, 252, 246, 0.72);
          position: relative;
          overflow: hidden;
        }
        .card.on {
          outline: 2px solid #2f4a3a;
          background: #fffdf8;
        }
        .card-main {
          display: block;
          width: 100%;
          text-align: left;
          border: 0;
          background: transparent;
          padding: 0;
          cursor: pointer;
          color: inherit;
        }
        .thumb {
          aspect-ratio: 1;
          background: #e9e4da;
          overflow: hidden;
          position: relative;
        }
        .sale-bang {
          position: absolute;
          right: 0.4rem;
          bottom: 0.4rem;
          z-index: 2;
          min-width: 1.55rem;
          height: 1.55rem;
          padding: 0 0.28rem;
          border-radius: 2px;
          background: #c43c1a;
          color: #fff;
          font-weight: 800;
          font-size: 0.92rem;
          line-height: 1;
          display: grid;
          place-items: center;
          box-shadow: 0 1px 4px rgba(40, 20, 10, 0.28);
        }
        .sale-mark {
          display: inline-block;
          margin-left: 0.35rem;
          color: #c43c1a;
          font-weight: 750;
          font-size: 0.72rem;
          line-height: 1.2;
          vertical-align: middle;
        }
        .sale-now {
          margin-left: 0.3rem;
          color: #c43c1a;
          font-weight: 700;
        }
        .sale-now.cheap {
          color: #1e4030;
        }
        .qty-mark {
          margin-left: 0.15rem;
          color: #1f3d2f;
          font-weight: 700;
        }
        .was {
          margin-left: 0.3rem;
          color: #8a6a62;
          font-weight: 500;
          text-decoration: line-through;
        }
        .thumb img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .ph {
          height: 100%;
          display: grid;
          place-items: center;
          opacity: 0.5;
          font-size: 0.85rem;
        }
        .body {
          padding: 0.55rem 0.6rem 0.35rem;
          display: flex;
          flex-direction: column;
          gap: 0.2rem;
        }
        .body strong {
          font-size: 0.88rem;
          line-height: 1.25;
        }
        .pill {
          align-self: flex-start;
          font-size: 0.68rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          padding: 0.12rem 0.35rem;
          background: #e6e0d4;
        }
        .pill.ok {
          background: #d5e6d8;
        }
        .pill.stale {
          background: #efe3b8;
        }
        .pill.unavailable,
        .pill.no_match {
          background: #e8e4de;
        }
        .pill.wrong_pack,
        .pill.wrong_size,
        .pill.rejected {
          background: #ecd5d0;
        }
        .pill.cheapest,
        .pill.cat-b {
          background: #d7e4ef;
          text-transform: none;
          letter-spacing: 0.02em;
        }
        .pill.cat-a {
          background: #eadcc8;
          text-transform: none;
          letter-spacing: 0.02em;
        }
        .price {
          font-size: 0.8rem;
          color: #2f4a3a;
        }
        .sku {
          font-size: 0.72rem;
          line-height: 1.25;
          color: #3a4038;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .unitprice {
          font-size: 0.72rem;
          color: #2f4a3a;
          font-weight: 600;
        }
        .age,
        .reason {
          font-size: 0.72rem;
          opacity: 0.9;
          line-height: 1.25;
          color: #7a4a32;
        }
        .mute {
          opacity: 0.55;
        }
        .check {
          position: absolute;
          top: 0.4rem;
          right: 0.45rem;
          width: 1.35rem;
          height: 1.35rem;
          background: #2f4a3a;
          color: #fff;
          display: grid;
          place-items: center;
          font-size: 0.85rem;
          opacity: 0;
        }
        .card.on .check {
          opacity: 1;
        }
        .votes {
          display: flex;
          gap: 0.35rem;
          padding: 0 0.5rem 0.55rem;
        }
        .votes button {
          border: 1px solid rgba(30, 40, 30, 0.2);
          background: #fff;
          cursor: pointer;
          padding: 0.2rem 0.45rem;
          font-size: 0.85rem;
        }
        .grams {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.35rem;
          padding: 0 0.55rem 0.45rem;
          font-size: 0.75rem;
        }
        .grams input {
          width: 5.2rem;
          border: 1px solid rgba(30, 40, 30, 0.25);
          background: #fff;
          padding: 0.28rem 0.4rem;
          font-size: 0.85rem;
        }
        .grams-est {
          flex-basis: 100%;
          font-size: 0.72rem;
          color: #2f4a3a;
          font-weight: 600;
        }
        .qty-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.3rem;
          padding: 0 0.55rem 0.45rem;
          font-size: 0.75rem;
        }
        .qty-input {
          width: 3.2rem;
          text-align: center;
          border: 1px solid rgba(30, 40, 30, 0.25);
          background: #fff;
          padding: 0.28rem 0.2rem;
          font-size: 0.9rem;
        }
        .qty-btn {
          min-height: 1.85rem;
          border: 1px solid rgba(30, 40, 30, 0.25);
          background: #fff;
          cursor: pointer;
          font-size: 0.75rem;
          line-height: 1.2;
          padding: 0.25rem 0.45rem;
          width: auto;
        }
        .qty-unit {
          opacity: 0.7;
        }
        .egg-picks {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.25rem;
          flex-basis: 100%;
        }
        .egg-picks > span {
          opacity: 0.75;
          margin-right: 0.15rem;
        }
        .qty-btn.egg-on {
          background: #1e4030;
          color: #fff;
          border-color: #1e4030;
        }
        .settings-btn {
          margin: 0 0.55rem 0.25rem 0;
          font: inherit;
          font-size: 0.75rem;
          padding: 0.25rem 0.5rem;
          cursor: pointer;
          background: #fff;
          border: 1px solid rgba(30, 40, 30, 0.25);
        }
        .card-tools {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          padding: 0 0.55rem;
        }
        .settings-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .settings-btn.danger,
        .cta.danger {
          color: #7a2424;
          border-color: rgba(122, 36, 36, 0.35);
        }
        .cta.danger {
          background: #f7ece8;
          color: #7a2424;
        }
        .card.skeleton {
          min-height: 12rem;
          pointer-events: none;
          opacity: 0.55;
        }
        .cart-bar {
          position: sticky;
          bottom: 0;
          z-index: 30;
          display: flex;
          flex-wrap: wrap;
          gap: 0.45rem;
          align-items: center;
          background: rgba(247, 243, 236, 0.96);
          border-top: 1px solid rgba(30, 40, 30, 0.12);
          padding: 0.55rem 0.2rem;
          margin: 0.8rem -0.2rem 0;
        }
        .cart-bar .cta {
          margin-left: auto;
        }
        .cart-drawer {
          background: #fffdf8;
          border: 1px solid rgba(30, 40, 30, 0.15);
          padding: 0.7rem 0.85rem;
          margin: 0.8rem 0;
        }
        .cart-drawer ul {
          list-style: none;
          padding: 0;
          margin: 0.4rem 0 0;
        }
        .cart-drawer li {
          display: flex;
          justify-content: space-between;
          gap: 0.5rem;
          padding: 0.25rem 0;
          font-size: 0.85rem;
        }
        .actions {
          margin: 1.25rem 0;
          display: flex;
          flex-wrap: wrap;
          gap: 0.6rem;
        }
        .cta {
          background: #1f3d2f;
          color: #f6f1e7;
          border: 0;
          padding: 0.85rem 1.25rem;
          font-size: 1rem;
          cursor: pointer;
        }
        .cta.secondary {
          background: transparent;
          color: #1f3d2f;
          border: 1px solid #1f3d2f;
        }
        .cta:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .err {
          color: #8b1e1e;
        }
        .results {
          margin-top: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 0.85rem;
        }
        h2 {
          font-family: Georgia, serif;
          margin: 0 0 0.25rem;
        }
        .row {
          border-top: 1px solid rgba(30, 40, 30, 0.18);
          padding-top: 0.85rem;
        }
        .row-head {
          display: flex;
          gap: 0.75rem;
          align-items: center;
          margin-bottom: 0.55rem;
        }
        .mini {
          width: 52px;
          height: 52px;
          object-fit: cover;
        }
        .badge {
          font-size: 0.8rem;
          opacity: 0.75;
        }
        .cols {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr 1fr;
          gap: 0.75rem;
        }
        @media (max-width: 800px) {
          .cols {
            grid-template-columns: 1fr !important;
          }
        }
        .store {
          font-size: 0.72rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          opacity: 0.6;
        }
        .big {
          font-size: 1.35rem;
          font-weight: 650;
          margin: 0.15rem 0;
        }
        .tiny {
          font-size: 0.78rem;
          line-height: 1.3;
        }
        .unit {
          font-size: 0.72rem;
          color: #2f4a3a;
          margin-top: 0.15rem;
        }
        .totals {
          margin-top: 0.5rem;
          padding: 1rem;
          background: rgba(47, 74, 58, 0.08);
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }
        .winner {
          margin-top: 0.25rem;
          font-weight: 650;
          color: #2f4a3a;
        }
        .plans {
          margin-top: 0.65rem;
          display: grid;
          gap: 0.45rem;
        }
        .plans h3 {
          font-size: 0.95rem;
          margin: 0.2rem 0 0;
        }
        .plan {
          border: 1px solid #d7cfc2;
          padding: 0.45rem 0.55rem 0.55rem;
          display: grid;
          gap: 0.2rem;
          background: #fffdf8;
        }
        .plan.rec {
          border-color: #1e4030;
          background: rgba(47, 74, 58, 0.08);
        }
        .plan-head {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem 0.55rem;
          align-items: baseline;
        }
        .plan-badge {
          font-size: 0.68rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          background: #1e4030;
          color: #fff;
          padding: 0.1rem 0.35rem;
        }
        .plan-badge.alt {
          background: transparent;
          color: #1e4030;
          border: 1px solid #1e4030;
        }
        .plan-stop {
          opacity: 0.9;
        }
        .log {
          margin-top: 1.5rem;
        }
        .log pre {
          overflow: auto;
          max-height: 320px;
          font-size: 0.72rem;
          background: rgba(0, 0, 0, 0.04);
          padding: 0.75rem;
        }
        .stats {
          margin-top: 2rem;
        }
        .stats h2 {
          margin: 0 0 0.35rem;
          font-size: 1.15rem;
        }
        .stats h3 {
          margin: 0.85rem 0 0.35rem;
          font-size: 0.92rem;
        }
        .stats-wins {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem 0.7rem;
          margin-top: 0.55rem;
          padding: 0.75rem 1rem;
          background: rgba(47, 74, 58, 0.08);
        }
        .stats-top ul,
        .stat-run-items {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .stats-top li,
        .stat-run-items li {
          display: grid;
          gap: 0.1rem;
          padding: 0.4rem 0;
          border-bottom: 1px solid rgba(40, 50, 40, 0.1);
          font-size: 0.88rem;
        }
        .stat-run {
          border: 1px solid rgba(40, 50, 40, 0.14);
          background: rgba(255, 252, 246, 0.72);
          margin-top: 0.45rem;
        }
        .stat-run-head {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 0.15rem;
          width: 100%;
          text-align: left;
          border: 0;
          background: transparent;
          padding: 0.7rem 0.85rem;
          cursor: pointer;
          color: inherit;
          font: inherit;
        }
        .stat-run.open .stat-run-head {
          background: rgba(47, 74, 58, 0.06);
        }
        .stat-run-items {
          padding: 0 0.85rem 0.7rem;
        }
      `}</style>
    </div>
  );
}

function Side({
  title,
  side,
  cheaperSale,
  audit,
}: {
  title: string;
  side: SideResult;
  grams?: number | null;
  qty?: number;
  cheaperSale?: boolean;
  audit?: {
    cell: OfferAuditCell;
    map: OfferVerdictMap;
    onRate: (cell: OfferAuditCell, verdict: OfferVerdictValue) => void;
  };
}) {
  const checkout = side.checkout;
  const productName = side.name ?? side.purchase?.name ?? null;
  const productImage = side.image ?? null;
  const cost = checkout?.valid ? checkout.checkoutCost : side.lineTotal;
  const usable = cost != null && Number.isFinite(cost);
  const reject =
    checkout?.reason ||
    side.matchStatus ||
    side.statusReason ||
    (side.status && side.status !== "ok" && side.status !== "stale"
      ? statusLabel(side.status)
      : null);

  return (
    <div>
      <span className="store">{title}</span>
      <div className="product">
        {productImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={productImage}
            alt={productName ?? title}
            className="product-photo"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="product-ph">No photo</div>
        )}
        <div className="product-name">
          {productName ? tidyOfferName(productName) : "немає товару"}
        </div>
      </div>
      {audit && (
        <OfferVerdictButtons
          cell={audit.cell}
          map={audit.map}
          onRate={audit.onRate}
        />
      )}
      <div>
        <span className={`pill ${side.status ?? "no_match"}`}>
          {statusLabel(side.status)}
        </span>
      </div>
      {usable ? (
        <>
          <div className="big">${cost!.toFixed(2)}</div>
          <div className="tiny">
            треба {side.requestedAmount ?? checkout?.purchasedAmount ?? "—"}
            {side.requestedUnit ? ` ${side.requestedUnit}` : ""}
          </div>
          {checkout?.packs != null && checkout.packAmount != null && (
            <div className="tiny">
              {checkout.packs} × {checkout.packAmount}{" "}
              {checkout.packUnit ?? side.requestedUnit ?? ""}
              {checkout.saleMode === "case" ? " (case)" : ""}
            </div>
          )}
          {checkout?.purchasedAmount != null && (
            <div className="tiny">
              куплено {checkout.purchasedAmount} {side.requestedUnit ?? ""}
              {checkout.leftoverAmount
                ? ` · leftover ${checkout.leftoverAmount}`
                : ""}
            </div>
          )}
          {checkout?.shelfPrice != null && (
            <div className="tiny mute">полиця ${checkout.shelfPrice.toFixed(2)}</div>
          )}
          {isShelfSale({
            price: side.shelfPrice ?? checkout?.shelfPrice ?? side.lineTotal,
            wasPrice: side.wasPrice,
            onSale: side.onSale,
          }) && (
            <div className="tiny sale-now">
              {cheaperSale
                ? side.wasPrice != null
                  ? `дешевше · знижка · було $${side.wasPrice.toFixed(2)}`
                  : "дешевше · знижка"
                : side.wasPrice != null
                  ? `знижка · було $${side.wasPrice.toFixed(2)}`
                  : "знижка"}
            </div>
          )}
          {checkout?.unitPrice != null && (
            <div className="tiny mute">
              ${checkout.unitPrice.toFixed(2)} / од. (лише для порівняння value)
            </div>
          )}
          {side.ageLabel && (
            <div className="tiny mute">
              {"\u0446\u0456\u043d\u0430 \u0432\u0456\u0434 "}
              {side.ageLabel}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mute">N/A</div>
          {reject && <div className="tiny mute">{reject}</div>}
          {checkout?.warning && (
            <div className="tiny mute">{checkout.warning}</div>
          )}
        </>
      )}
      <style jsx>{`
        .product {
          display: flex;
          gap: 0.55rem;
          align-items: center;
          margin: 0.35rem 0 0.2rem;
        }
        .product-photo,
        .product-ph {
          width: 72px;
          height: 72px;
          object-fit: cover;
          flex-shrink: 0;
          background: #e9e4da;
        }
        .product-ph {
          display: grid;
          place-items: center;
          font-size: 0.62rem;
          color: #7a7468;
        }
        .product-name {
          font-size: 0.88rem;
          font-weight: 650;
          line-height: 1.25;
        }
        .store {
          font-size: 0.72rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          opacity: 0.6;
        }
        .pill {
          display: inline-block;
          font-size: 0.68rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          padding: 0.12rem 0.35rem;
          background: #e6e0d4;
          margin: 0.25rem 0;
        }
        .pill.ok {
          background: #d5e6d8;
        }
        .pill.stale {
          background: #efe3b8;
        }
        .pill.wrong_pack,
        .pill.wrong_size,
        .pill.rejected {
          background: #ecd5d0;
        }
        .big {
          font-size: 1.35rem;
          font-weight: 650;
          margin: 0.15rem 0;
        }
        .unit {
          font-size: 0.78rem;
          font-weight: 650;
          color: #2f4a3a;
        }
        .tiny {
          font-size: 0.78rem;
          line-height: 1.3;
        }
        .sale-now {
          color: #c43c1a;
          font-weight: 700;
        }
        .mute {
          opacity: 0.55;
        }
      `}</style>
    </div>
  );
}
