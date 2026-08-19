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
import {
  addCartItem,
  applyProductOverride,
  cartSize,
  clearCart,
  removeCartItem,
  setCartCustomAmount,
  toRestaurantProduct,
  type AmountUnit,
  type Cart,
  type ProductOverride,
  type RestaurantProduct,
} from "@/domain/restaurant-product";
import {
  CART_STORAGE_KEY,
  PRODUCT_OVERRIDE_STORAGE_KEY,
} from "@/lib/product-config";
import { toBase } from "@/domain/purchase-units";
import {
  looseWeightPurchase,
  purchasePlanForPack,
} from "@/domain/needed-weight-pick";

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
};

type StoreCoverage = {
  requestedItems: number;
  availableComparableItems: number;
  checkoutTotal: number | null;
  complete: boolean;
  coverage?: string;
};

type CompareTotals = {
  walmart: number;
  noFrills: number;
  wholesaleClub?: number;
  mvr?: number;
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

function saleTitle(item: Staple): string {
  const bits: string[] = [];
  if (item.walmartCached?.onSale) {
    bits.push(
      item.walmartCached.wasPrice
        ? `WM знижка: було $${item.walmartCached.wasPrice.toFixed(2)}`
        : "WM зараз на знижці",
    );
  }
  if (item.noFrillsCached?.onSale) {
    bits.push(
      item.noFrillsCached.wasPrice
        ? `NF знижка: було $${item.noFrillsCached.wasPrice.toFixed(2)}`
        : "NF зараз на знижці",
    );
  }
  if (item.wholesaleClubCached?.onSale) {
    bits.push(
      item.wholesaleClubCached.wasPrice
        ? `WC знижка: було $${item.wholesaleClubCached.wasPrice.toFixed(2)}`
        : "WC зараз на знижці",
    );
  }
  if (item.mvrCached?.onSale) {
    bits.push(
      item.mvrCached.wasPrice
        ? `MVR знижка: було $${item.mvrCached.wasPrice.toFixed(2)}`
        : "MVR зараз на знижці",
    );
  }
  return bits.join(" · ") || "Зараз на знижці";
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

function storeShort(cheaper: string): string {
  if (cheaper === "walmart") return "Walmart";
  if (cheaper === "nofrills") return "No Frills";
  if (cheaper === "wholesaleclub") return "Wholesale Club";
  if (cheaper === "mvr") return "MVR";
  if (cheaper === "tie") return "нічия";
  return "неповне";
}

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "N/A";
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
    walmart: number;
    noFrills: number;
    wholesaleClub: number;
    mvr: number;
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
  const [overrides, setOverrides] = useState<Record<string, ProductOverride>>({});
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
  const [walmartSource, setWalmartSource] = useState<
    "rapid" | "browser" | "missing_key" | null
  >(null);
  const [walmartSourceWarning, setWalmartSourceWarning] = useState<
    string | null
  >(null);
  const [statsSummary, setStatsSummary] = useState<StatsSummary | null>(null);
  const [statsRuns, setStatsRuns] = useState<StatsRun[]>([]);
  const [openRunId, setOpenRunId] = useState<string | null>(null);

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
      setItems(data.items);
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
    reload().catch((e) =>
      setError(friendlyError(e instanceof Error ? e.message : String(e))),
    );
    reloadStats().catch(() => undefined);
    try {
      const rawCart = window.localStorage.getItem(CART_STORAGE_KEY);
      if (rawCart) {
        const parsed = JSON.parse(rawCart) as Cart;
        if (parsed && typeof parsed === "object") setCart(parsed);
      }
      const rawOv = window.localStorage.getItem(PRODUCT_OVERRIDE_STORAGE_KEY);
      if (rawOv) {
        const parsed = JSON.parse(rawOv) as Record<string, ProductOverride>;
        if (parsed && typeof parsed === "object") setOverrides(parsed);
      }
    } catch {
      /* ignore */
    }
  }, [reload, reloadStats]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    } catch {
      /* ignore */
    }
  }, [cart]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        PRODUCT_OVERRIDE_STORAGE_KEY,
        JSON.stringify(overrides),
      );
    } catch {
      /* ignore */
    }
  }, [overrides]);

  function productOf(item: Staple): RestaurantProduct {
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
  }

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (!q) return true;
      const blob = [
        item.label,
        item.walmartCached?.name,
        item.noFrillsCached?.name,
        item.wholesaleClubCached?.name,
        item.mvrCached?.name,
        item.walmartCached?.productId,
        item.noFrillsCached?.productId,
        item.wholesaleClubCached?.productId,
        item.mvrCached?.productId,
        item.sobeysCached?.name,
        item.sobeysCached?.productId,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [items, query]);

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

  async function onAdopted(id: string) {
    await reload();
    pickStaple(id);
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

  function persistOverrides(next: Record<string, ProductOverride>) {
    setOverrides(next);
    try {
      window.localStorage.setItem(
        PRODUCT_OVERRIDE_STORAGE_KEY,
        JSON.stringify(next),
      );
    } catch {
      /* ignore */
    }
  }

  async function saveProductSettings(
    item: Staple,
    override: ProductOverride,
    matchModeChanged: boolean,
  ) {
    const prev = productOf(item);
    const nextOverride: ProductOverride = {
      ...overrides[item.id],
      ...override,
      needsReview: matchModeChanged ? true : overrides[item.id]?.needsReview,
    };
    if (matchModeChanged) nextOverride.needsReview = true;
    persistOverrides({ ...overrides, [item.id]: nextOverride });
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
        }),
      });
    } catch {
      /* Vercel FS may be read-only; localStorage is the live store. */
    }
    if (matchModeChanged) {
      await reload();
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
      body: JSON.stringify({ id: item.id, override: next[item.id] }),
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
          body: JSON.stringify({ ids: [...selected] }),
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
          body: JSON.stringify({ ids: [...selected] }),
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
          body: JSON.stringify({ ids: [...selected] }),
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
          body: JSON.stringify({ ids: [...selected] }),
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
          body: JSON.stringify({ ids: [...selected] }),
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
          body: JSON.stringify({ ids }),
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

  return (
    <div className="staples">
      <header className="hero">
        <p className="brand">Royal SASS</p>
        <h1>Cafe staples</h1>
        <p className="sub">
          Walmart #5831 vs No Frills #3660 vs Wholesale Club #3724 vs MVR Cash
          & Carry (3655 Weston Rd). <strong>А</strong> — точний продукт.{" "}
          <strong>Б</strong> — найдешевший відповідний (бренд не важливий).
          Кількість за замовчуванням береться з картки; зміна в кошику не
          змінює дефолт, поки не натиснеш «Зберегти як новий дефолт».
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
            ? " · кеш застарів — натисни «Оновити ціни»"
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
          onAdopted={(id) => {
            void onAdopted(id);
          }}
        />
      </header>

      <section className="grid">
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
          const isCatB = product.matchMode === "cheapest_equivalent";
          const entry = cart[item.id];
          const requested = entry?.requestedAmount ?? product.defaultAmount;
          const neededBase = toBase(requested, product.unit);
          const neededG = neededBase.unit === "g" ? neededBase.amount : null;
          const cat = matchCategory(product.matchMode);
          const thumb =
            isCatB && item.walmartCached?.image
              ? item.walmartCached.image
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
                  {item.onSale && (
                    <span className="sale-bang" title={saleTitle(item)}>
                      !
                    </span>
                  )}
                </div>
                <div className="body">
                  <strong>
                    {item.label}
                    {item.onSale ? (
                      <span className="sale-mark" title={saleTitle(item)}>
                        !
                      </span>
                    ) : null}
                    {on && entry?.isCustom ? (
                      <span className="qty-mark">
                        {" "}
                        {requested} {product.unit}
                      </span>
                    ) : null}
                  </strong>
                  <span className={`pill ${item.status}`}>
                    {statusLabel(item.status)}
                  </span>
                  <span className={`pill cat-${cat.key}`} title={cat.title}>
                    {cat.short}
                  </span>
                  {item.walmartCached ? (
                    <>
                      <span className="sku">
                        WM {tidyOfferName(item.walmartCached.name)}
                      </span>
                      <span className="price">
                        WM ${item.walmartCached.price.toFixed(2)}
                        {item.walmartCached.onSale &&
                        item.walmartCached.wasPrice ? (
                          <s className="was">
                            ${item.walmartCached.wasPrice.toFixed(2)}
                          </s>
                        ) : null}
                        {item.walmartCached.packageSize
                          ? ` · ${item.walmartCached.packageSize}`
                          : ""}
                      </span>
                      {item.weightCompare &&
                        item.walmartCached.nativeUnitPriceLabel && (
                          <span className="unitprice">
                            {item.walmartCached.nativeUnitPriceLabel}
                          </span>
                        )}
                    </>
                  ) : (
                    <span className="price mute">немає WM ціни</span>
                  )}
                  {item.noFrillsCached ? (
                    <>
                      <span className="sku">
                        NF {tidyOfferName(item.noFrillsCached.name)}
                      </span>
                      <span className="price">
                        NF ${item.noFrillsCached.price.toFixed(2)}
                        {item.noFrillsCached.onSale &&
                        item.noFrillsCached.wasPrice ? (
                          <s className="was">
                            ${item.noFrillsCached.wasPrice.toFixed(2)}
                          </s>
                        ) : null}
                        {item.noFrillsCached.packageSize
                          ? ` · ${item.noFrillsCached.packageSize}`
                          : ""}
                      </span>
                      {item.weightCompare &&
                        item.noFrillsCached.nativeUnitPriceLabel && (
                          <span className="unitprice">
                            {item.noFrillsCached.nativeUnitPriceLabel}
                          </span>
                        )}
                    </>
                  ) : (
                    <span className="price mute">немає NF ціни</span>
                  )}
                  {item.wholesaleClubCached ? (
                    <>
                      <span className="sku">
                        WC {tidyOfferName(item.wholesaleClubCached.name)}
                      </span>
                      <span className="price">
                        WC ${item.wholesaleClubCached.price.toFixed(2)}
                        {item.wholesaleClubCached.onSale &&
                        item.wholesaleClubCached.wasPrice ? (
                          <s className="was">
                            ${item.wholesaleClubCached.wasPrice.toFixed(2)}
                          </s>
                        ) : null}
                        {item.wholesaleClubCached.packageSize
                          ? ` · ${item.wholesaleClubCached.packageSize}`
                          : ""}
                      </span>
                      {item.weightCompare &&
                        item.wholesaleClubCached.nativeUnitPriceLabel && (
                          <span className="unitprice">
                            {item.wholesaleClubCached.nativeUnitPriceLabel}
                          </span>
                        )}
                    </>
                  ) : (
                    <span className="price mute">немає WC ціни</span>
                  )}
                  {item.mvrCached ? (
                    <>
                      <span className="sku">
                        MVR {tidyOfferName(item.mvrCached.name)}
                      </span>
                      <span className="price">
                        MVR ${item.mvrCached.price.toFixed(2)}
                        {item.mvrCached.onSale && item.mvrCached.wasPrice ? (
                          <s className="was">
                            ${item.mvrCached.wasPrice.toFixed(2)}
                          </s>
                        ) : null}
                        {item.mvrCached.packageSize
                          ? ` · ${item.mvrCached.packageSize}`
                          : ""}
                      </span>
                      {item.weightCompare &&
                        item.mvrCached.nativeUnitPriceLabel && (
                          <span className="unitprice">
                            {item.mvrCached.nativeUnitPriceLabel}
                          </span>
                        )}
                    </>
                  ) : (
                    <span className="price mute">немає MVR ціни</span>
                  )}
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
                  {item.ageLabel && (
                    <span className="age">
                      {"WM \u0446\u0456\u043d\u0430 \u0432\u0456\u0434 "}
                      {item.ageLabel}
                    </span>
                  )}
                  {item.noFrillsCached?.ageLabel && (
                    <span className="age">
                      {"NF \u0446\u0456\u043d\u0430 \u0432\u0456\u0434 "}
                      {item.noFrillsCached.ageLabel}
                    </span>
                  )}
                  {item.wholesaleClubCached?.ageLabel && (
                    <span className="age">
                      {"WC \u0446\u0456\u043d\u0430 \u0432\u0456\u0434 "}
                      {item.wholesaleClubCached.ageLabel}
                    </span>
                  )}
                  {item.mvrCached?.ageLabel && (
                    <span className="age">
                      {"MVR \u0446\u0456\u043d\u0430 \u0432\u0456\u0434 "}
                      {item.mvrCached.ageLabel}
                    </span>
                  )}
                  {isCatB &&
                    neededG != null &&
                    (() => {
                      const wmBuy = categoryBPreview(
                        item.walmartCached,
                        neededG,
                        Boolean(item.soldByWeight),
                        item.typicalEachGrams,
                      );
                      const nfBuy = categoryBPreview(
                        item.noFrillsCached,
                        neededG,
                        Boolean(item.soldByWeight),
                        item.typicalEachGrams,
                      );
                      const wcBuy = categoryBPreview(
                        item.wholesaleClubCached ?? null,
                        neededG,
                        Boolean(item.soldByWeight),
                        item.typicalEachGrams,
                      );
                      const mvrBuy = categoryBPreview(
                        item.mvrCached ?? null,
                        neededG,
                        Boolean(item.soldByWeight),
                        item.typicalEachGrams,
                      );
                      if (!wmBuy && !nfBuy && !wcBuy && !mvrBuy) return null;
                      return (
                        <>
                          {wmBuy && (
                            <span className="unitprice">
                              WM {formatBBuy(wmBuy)}
                            </span>
                          )}
                          {nfBuy && (
                            <span className="unitprice">
                              NF {formatBBuy(nfBuy)}
                            </span>
                          )}
                          {wcBuy && (
                            <span className="unitprice">
                              WC {formatBBuy(wcBuy)}
                            </span>
                          )}
                          {mvrBuy && (
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
                <div className="qty-row">
                  <span>
                    Зазвичай: {product.defaultAmount} {product.unit}
                  </span>
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
                          <span className="qty-unit">{product.unit}</span>
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
              <div className="votes">
                <button
                  type="button"
                  title="Підтвердити матч"
                  onClick={(e) =>
                    vote(item.id, "up", item.walmartCached?.productId, e)
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
            </div>
          );
        })}
        {catalogReady && visibleItems.length === 0 && (
          <p className="empty-grid">
            {query.trim()
              ? "У списку немає такого товару — обери з підказок вище, щоб додати."
              : "Немає карток."}
          </p>
        )}
      </section>

      {settingsId &&
        (() => {
          const item = items.find((x) => x.id === settingsId);
          if (!item) return null;
          const product = productOf(item);
          return (
            <ProductSettings
              product={product}
              open
              onClose={() => setSettingsId(null)}
              onSave={(ov, changed) => {
                void saveProductSettings(item, ov, changed);
              }}
              confirmedStoreProducts={
                overrides[item.id]?.confirmedStoreProducts
              }
              storeOffers={[
                {
                  retailer: "walmart_ca",
                  label: "Walmart",
                  productId: item.walmartCached?.productId,
                  name: item.walmartCached?.name,
                },
                {
                  retailer: "no_frills",
                  label: "No Frills",
                  productId: item.noFrillsCached?.productId,
                  name: item.noFrillsCached?.name,
                },
                {
                  retailer: "wholesale_club",
                  label: "Wholesale Club",
                  productId: item.wholesaleClubCached?.productId,
                  name: item.wholesaleClubCached?.name,
                },
                {
                  retailer: "mvr",
                  label: "MVR",
                  productId: item.mvrCached?.productId,
                  name: item.mvrCached?.name,
                },
              ]}
            />
          );
        })()}

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
                    {item?.label ?? id} · {e.requestedAmount} {e.unit}
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
      </div>

      {error && <p className="err">{error}</p>}

      {rows && (
        <section className="results">
          <h2>Results</h2>
          {rows.map((r) => (
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
                      ? ` · треба ${r.requestedAmount} ${r.requestedUnit ?? ""}`
                      : r.grams
                        ? ` · ${r.grams} g`
                        : r.qty != null && r.qty > 1
                          ? ` · ×${r.qty}`
                          : ""}
                  </strong>
                  <div className="badge">
                    {r.cheaper === "incomplete" && r.fairBasis === "incomparable"
                      ? "Incomparable"
                      : cheaperLabel(r.cheaper)}
                    {r.delta != null && r.cheaper !== "tie"
                      ? ` · Δ $${Math.abs(r.delta).toFixed(2)}`
                      : ""}
                    {r.fairLabel ? ` · ${r.fairLabel}` : ""}
                  </div>
                </div>
              </div>
              <div className="cols">
                <Side
                  title="Walmart"
                  side={r.walmart}
                  grams={r.grams}
                  qty={r.qty}
                />
                <Side
                  title="No Frills"
                  side={r.noFrills}
                  grams={r.grams}
                  qty={r.qty}
                />
                <Side
                  title="Wholesale Club"
                  side={r.wholesaleClub ?? { lineTotal: null, status: "no_match" }}
                  grams={r.grams}
                  qty={r.qty}
                />
                <Side
                  title="MVR Cash & Carry"
                  side={r.mvr ?? { lineTotal: null, status: "no_match" }}
                  grams={r.grams}
                  qty={r.qty}
                />
              </div>
            </article>
          ))}

          {totals && (
            <div className="totals">
              <div>
                Walmart:{" "}
                <strong>
                  {money(totals.walmartComplete?.checkoutTotal)}
                </strong>
                {totals.walmartComplete?.coverage
                  ? ` · ${totals.walmartComplete.coverage}`
                  : ""}
              </div>
              <div>
                No Frills:{" "}
                <strong>
                  {money(totals.noFrillsComplete?.checkoutTotal)}
                </strong>
                {totals.noFrillsComplete?.coverage
                  ? ` · ${totals.noFrillsComplete.coverage}`
                  : ""}
              </div>
              <div>
                Wholesale Club:{" "}
                <strong>
                  {money(totals.wholesaleClubComplete?.checkoutTotal)}
                </strong>
                {totals.wholesaleClubComplete?.coverage
                  ? ` · ${totals.wholesaleClubComplete.coverage}`
                  : ""}
              </div>
              <div>
                MVR:{" "}
                <strong>{money(totals.mvrComplete?.checkoutTotal)}</strong>
                {totals.mvrComplete?.coverage
                  ? ` · ${totals.mvrComplete.coverage}`
                  : ""}
              </div>
              <div className="winner">
                {totals.cheaper === "incomplete"
                  ? "Немає повного кошика — загального переможця немає"
                  : totals.cheaper === "walmart"
                    ? "Cheaper overall: Walmart"
                    : totals.cheaper === "nofrills"
                      ? "Cheaper overall: No Frills"
                      : totals.cheaper === "wholesaleclub"
                        ? "Cheaper overall: Wholesale Club"
                        : totals.cheaper === "mvr"
                          ? "Cheaper overall: MVR"
                          : "Overall: tie"}
              </div>
              {totals.incompleteItems && totals.incompleteItems.length > 0 && (
                <div className="tiny">
                  Неповні:{" "}
                  {totals.incompleteItems
                    .map((it) => `${it.label} (${it.missing.join(", ")})`)
                    .join(" · ")}
                </div>
              )}
              {totals.note && <div className="tiny mute">{totals.note}</div>}
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
                        {money(run.totals.walmart)}
                        {" · NF "}
                        {money(run.totals.noFrills)}
                        {" · WC "}
                        {money(run.totals.wholesaleClub)}
                        {" · MVR "}
                        {money(run.totals.mvr)}
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
          width: 1.55rem;
          height: 1.55rem;
          border-radius: 2px;
          background: #c43c1a;
          color: #fff;
          font-weight: 800;
          font-size: 1.15rem;
          line-height: 1;
          display: grid;
          place-items: center;
          box-shadow: 0 1px 4px rgba(40, 20, 10, 0.28);
        }
        .sale-mark {
          margin-left: 0.2rem;
          color: #c43c1a;
          font-weight: 800;
          font-size: 1.05rem;
          line-height: 1;
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
        .settings-btn {
          margin: 0 0.55rem 0.25rem;
          font: inherit;
          font-size: 0.75rem;
          padding: 0.25rem 0.5rem;
          cursor: pointer;
          background: #fff;
          border: 1px solid rgba(30, 40, 30, 0.25);
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
            grid-template-columns: 1fr;
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
}: {
  title: string;
  side: SideResult;
  grams?: number | null;
  qty?: number;
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
              {checkout.packs} × {checkout.packAmount} {side.requestedUnit ?? ""}
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
        .mute {
          opacity: 0.55;
        }
      `}</style>
    </div>
  );
}
