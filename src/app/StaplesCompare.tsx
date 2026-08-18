"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type MouseEvent,
} from "react";
import { ProductSearch } from "./ProductSearch";
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
  matchMode?: "preferred" | "cheapest";
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
  cheaper: string;
  delta: number | null;
  soldByWeight?: boolean;
  grams?: number | null;
  qty?: number;
  fairLabel?: string | null;
  fairBasis?: string | null;
  matchKind?: string | null;
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
  return bits.join(" · ") || "Зараз на знижці";
}

function matchCategory(mode?: "preferred" | "cheapest"): {
  key: "a" | "b";
  short: string;
  title: string;
} {
  if (mode === "cheapest") {
    return {
      key: "b",
      short: "Б · найдешевший",
      title:
        "Категорія Б: овочі, фрукти, яйця в шкаралупі, frozen — будь-який бренд, беремо найдешевший за одиницю",
    };
  }
  return {
    key: "a",
    short: "А · саме цей",
    title:
      "Категорія А: саме цей продукт (бренд і SKU). Не підміняємо дешевшим аналогом",
  };
}

function statusLabel(s?: OfferStatus | string | null): string {
  switch (s) {
    case "ok":
      return "ok";
    case "unavailable":
      return "unavailable";
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<CompareRow[] | null>(null);
  const [totals, setTotals] = useState<{
    walmart: number;
    noFrills: number;
    cheaper: string;
    completeCount: number;
    note?: string;
  } | null>(null);
  const [matchLogId, setMatchLogId] = useState<string | null>(null);
  const [logPreview, setLogPreview] = useState<unknown[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [catalogAt, setCatalogAt] = useState<string | null>(null);
  const [nfCatalogAt, setNfCatalogAt] = useState<string | null>(null);
  const [sobeysCatalogAt, setSobeysCatalogAt] = useState<string | null>(null);
  const [staleHours, setStaleHours] = useState(24);
  const [gramsById, setGramsById] = useState<Record<string, string>>({});
  const [qtyById, setQtyById] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [walmartSource, setWalmartSource] = useState<
    "rapid" | "browser" | "missing_key" | null
  >(null);
  const [walmartSourceWarning, setWalmartSourceWarning] = useState<
    string | null
  >(null);

  const reload = useCallback(async () => {
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
    setSobeysCatalogAt(data.sobeysCatalogCheckedAt ?? null);
    setStaleHours(data.cacheStaleHours ?? 24);
    setWalmartSource(data.walmartSource ?? null);
    setWalmartSourceWarning(data.walmartSourceWarning ?? null);
  }, []);

  useEffect(() => {
    reload().catch((e) =>
      setError(friendlyError(e instanceof Error ? e.message : String(e))),
    );
  }, [reload]);

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (!q) return true;
      const blob = [
        item.label,
        item.walmartCached?.name,
        item.noFrillsCached?.name,
        item.walmartCached?.productId,
        item.noFrillsCached?.productId,
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
    return isOld(catalogAt) || isOld(nfCatalogAt);
  }, [catalogAt, nfCatalogAt]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        setQtyById((q) => (q[id] ? q : { ...q, [id]: "1" }));
      }
      return next;
    });
  }

  function pickStaple(id: string) {
    setSelected((prev) => new Set(prev).add(id));
    setQtyById((q) => (q[id] ? q : { ...q, [id]: "1" }));
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

  function setGrams(id: string, value: string) {
    setGramsById((prev) => ({ ...prev, [id]: value }));
    const n = Number.parseFloat(value);
    if (Number.isFinite(n) && n > 0) {
      setSelected((prev) => new Set(prev).add(id));
    }
  }

  function setPackQty(id: string, value: string) {
    const cleaned = value.replace(/[^\d]/g, "");
    setQtyById((prev) => ({ ...prev, [id]: cleaned }));
    const n = Number.parseInt(cleaned, 10);
    if (Number.isFinite(n) && n > 0) {
      setSelected((prev) => new Set(prev).add(id));
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  function bumpPackQty(id: string, delta: number, e?: MouseEvent) {
    e?.stopPropagation();
    e?.preventDefault();
    const current = Number.parseInt(qtyById[id] ?? (selected.has(id) ? "1" : "0"), 10);
    const next = Math.max(0, (Number.isFinite(current) ? current : 0) + delta);
    if (next < 1) {
      setQtyById((prev) => ({ ...prev, [id]: "" }));
      setSelected((prev) => {
        const copy = new Set(prev);
        copy.delete(id);
        return copy;
      });
      return;
    }
    setQtyById((prev) => ({ ...prev, [id]: String(next) }));
    setSelected((prev) => new Set(prev).add(id));
  }

  function gramsPayload(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const id of selected) {
      const n = Number.parseFloat(gramsById[id] ?? "");
      if (Number.isFinite(n) && n > 0) out[id] = n;
    }
    return out;
  }

  function qtyPayload(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const id of selected) {
      const n = Number.parseInt(qtyById[id] ?? "1", 10);
      if (Number.isFinite(n) && n > 0) out[id] = n;
    }
    return out;
  }

  async function deleteStaples(ids: string[], label?: string) {
    if (!ids.length) return;
    const who =
      ids.length === 1
        ? `«${label ?? ids[0]}»`
        : `${ids.length} вибраних товарів`;
    const ok = window.confirm(
      `Видалити ${who} з проєкту назавжди (список, ціни, матчі)?`,
    );
    if (!ok) return;
    setError(null);
    setBusy("delete");
    try {
      const res = await fetch("/api/staples/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "delete failed");
      const gone = new Set<string>(
        Array.isArray(data.deleted) ? data.deleted.filter((x: unknown) => typeof x === "string") : ids,
      );
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of gone) next.delete(id);
        return next;
      });
      setRows((prev) => (prev ? prev.filter((r) => !gone.has(r.id)) : prev));
      await reload();
    } catch (e) {
      setError(e instanceof Error ? friendlyError(e.message) : String(e));
    } finally {
      setBusy(null);
    }
  }

  const allVisibleSelected =
    visibleItems.length > 0 &&
    visibleItems.every((item) => selected.has(item.id));

  function selectAllVisible() {
    const ids = visibleItems.map((item) => item.id);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    setQtyById((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        if (!next[id]) next[id] = "1";
      }
      return next;
    });
  }

  function clearVisibleSelection() {
    const ids = new Set(visibleItems.map((item) => item.id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
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
            grams: gramsPayload(),
            qty: qtyPayload(),
          }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error ?? "compare failed");
        setRows(data.rows);
        setTotals(data.totals);
        setMatchLogId(data.matchLogId ?? null);
        setLogPreview(null);
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
        const nfBlock = data.noFrills?.blocked as string | undefined;
        setLogPreview(data);
        await reload();
        if (data.walmartSource === "missing_key") {
          setError(
            `No Frills ${nfN ? `оновлено ${nfN}` : "без змін"}. RapidAPI ключ порожній — ціни WM не чіпали.`,
          );
        } else if (nfBlock) {
          setError(
            `WM оновлено ${wmN}. No Frills зараз недоступний з цього сервера (401) — NF кеш не змінювався.`,
          );
        } else if (wmN === 0 && nfN === 0) {
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
    e?: MouseEvent,
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
          Walmart #5831 vs No Frills #3660. Для овочів/фруктів і frozen на картці: WM —{" "}
          <strong>за 1 kg</strong>, No Frills — <strong>за 1 lb</strong>. Угода при
          різних пачках — <strong>за 100 г</strong>. Товари
          на вагу: після вибору вкажи скільки <strong>грам</strong> потрібно.
          Решта — <strong>кількість пачок</strong> (за замовчуванням 1).{" "}
          <strong>А</strong> — саме цей продукт. <strong>Б</strong> — овочі й
          фрукти (найдешевший, бренд не важливий).
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
          {sobeysCatalogAt
            ? ` · Sobeys флаєр ${new Date(sobeysCatalogAt).toLocaleString()}`
            : ""}
          {cacheIsOld
            ? " · кеш застарів — натисни «Оновити ціни»"
            : ""}
          {walmartSource === "missing_key" && walmartSourceWarning
            ? " · додай RapidAPI ключ у .env / Vercel"
            : ""}
          {" · × на картці видаляє товар з проєкту"}
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
        {visibleItems.map((item) => {
          const on = selected.has(item.id);
          const isCatB = item.matchMode === "cheapest";
          const gramsVal = gramsById[item.id] ?? "";
          const gramsN = Number.parseFloat(gramsVal);
          const neededG =
            Number.isFinite(gramsN) && gramsN > 0
              ? gramsN
              : on && isCatB
                ? item.soldByWeight
                  ? 1000
                  : 500
                : null;
          const estKg =
            item.soldByWeight && neededG != null ? neededG / 1000 : null;
          const wmEst =
            estKg != null && item.walmartCached?.pricePerKg
              ? item.walmartCached.pricePerKg * estKg
              : null;
          const nfEst =
            estKg != null && item.noFrillsCached?.pricePerKg
              ? item.noFrillsCached.pricePerKg * estKg
              : null;
          const packRaw = qtyById[item.id];
          const packParsed = Number.parseInt(
            packRaw ?? (on ? "1" : "0"),
            10,
          );
          const packN =
            !isCatB &&
            !item.soldByWeight &&
            Number.isFinite(packParsed) &&
            packParsed > 0
              ? packParsed
              : on && !isCatB && !item.soldByWeight
                ? 1
                : 0;
          const wmPackEst =
            packN > 1 && item.walmartCached
              ? item.walmartCached.price * packN
              : null;
          const nfPackEst =
            packN > 1 && item.noFrillsCached
              ? item.noFrillsCached.price * packN
              : null;
          const cat = matchCategory(item.matchMode);
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
                    {packN > 1 ? (
                      <span className="qty-mark"> ×{packN}</span>
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
                      if (!wmBuy && !nfBuy) return null;
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
                        </>
                      );
                    })()}
                  {item.statusReason && (
                    <span className="reason">{item.statusReason}</span>
                  )}
                </div>
                <span className="check">{on ? "✓" : ""}</span>
              </button>
              <button
                type="button"
                className="hide-card"
                title="Видалити товар з проєкту"
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteStaples([item.id], item.label);
                }}
              >
                ×
              </button>
              {isCatB || item.soldByWeight ? (
                on && (
                  <label className="grams">
                    <span>грам</span>
                    <input
                      type="number"
                      min={1}
                      step={50}
                      inputMode="numeric"
                      placeholder={item.soldByWeight ? "1000" : "500"}
                      value={gramsVal}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setGrams(item.id, e.target.value)}
                    />
                    {(wmEst != null || nfEst != null) && (
                      <span className="grams-est">
                        {wmEst != null ? `WM $${wmEst.toFixed(2)}` : ""}
                        {wmEst != null && nfEst != null ? " · " : ""}
                        {nfEst != null ? `NF $${nfEst.toFixed(2)}` : ""}
                      </span>
                    )}
                  </label>
                )
              ) : (
                <div className="qty-row">
                  <span>кількість</span>
                  <button
                    type="button"
                    className="qty-btn"
                    aria-label="менше"
                    onClick={(e) => bumpPackQty(item.id, -1, e)}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    className="qty-input"
                    value={packRaw ?? (on ? "1" : "")}
                    placeholder="0"
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setPackQty(item.id, e.target.value)}
                  />
                  <button
                    type="button"
                    className="qty-btn"
                    aria-label="більше"
                    onClick={(e) => bumpPackQty(item.id, 1, e)}
                  >
                    +
                  </button>
                  <span className="qty-unit">пачок</span>
                  {(wmPackEst != null || nfPackEst != null) && (
                    <span className="grams-est">
                      {wmPackEst != null ? `WM $${wmPackEst.toFixed(2)}` : ""}
                      {wmPackEst != null && nfPackEst != null ? " · " : ""}
                      {nfPackEst != null ? `NF $${nfPackEst.toFixed(2)}` : ""}
                    </span>
                  )}
                </div>
              )}
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
        {visibleItems.length === 0 && (
          <p className="empty-grid">
            {query.trim()
              ? "У списку немає такого товару — обери з підказок вище, щоб додати."
              : "Немає карток."}
          </p>
        )}
      </section>

      <div className="actions">
        <button
          type="button"
          className="cta secondary"
          disabled={pending || visibleItems.length === 0 || busy != null}
          onClick={allVisibleSelected ? clearVisibleSelection : selectAllVisible}
        >
          {allVisibleSelected
            ? "Зняти всі"
            : `Виділити всі (${visibleItems.length})`}
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
          className="cta"
          disabled={pending || selected.size === 0 || busy != null}
          onClick={runCompare}
        >
          {busy === "compare"
            ? "Comparing…"
            : `Compare ${selected.size} items`}
        </button>
        <button
          type="button"
          className="cta secondary"
          disabled={
            pending ||
            selected.size === 0 ||
            busy != null ||
            walmartSource === "missing_key"
          }
          onClick={refreshSelected}
        >
          {busy === "refresh"
            ? "Refreshing WM…"
            : `Refresh WM (${selected.size})`}
        </button>
        <button
          type="button"
          className="cta secondary"
          disabled={pending || selected.size === 0 || busy != null}
          onClick={refreshNoFrillsSelected}
        >
          {busy === "refresh-nf"
            ? "Refreshing NF…"
            : `Refresh NF (${selected.size})`}
        </button>
        <button
          type="button"
          className="cta secondary"
          disabled={pending || selected.size === 0 || busy != null}
          onClick={refreshSobeysSelected}
        >
          {busy === "refresh-sobeys"
            ? "Refreshing Sobeys flyer…"
            : `Refresh Sobeys flyer (${selected.size})`}
        </button>
        <button
          type="button"
          className="cta secondary"
          disabled={pending || selected.size === 0 || busy != null}
          onClick={() => void deleteStaples([...selected])}
        >
          {busy === "delete"
            ? "Видаляю…"
            : `Видалити вибрані (${selected.size})`}
        </button>
      </div>

      {error && <p className="err">{error}</p>}

      {rows && (
        <section className="results">
          <h2>Results</h2>
          {matchLogId && (
            <p className="meta">Match log: data/runs/{matchLogId}.json</p>
          )}
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
                    {r.grams
                      ? ` · ${r.grams} g`
                      : r.qty != null && r.qty > 1
                        ? ` · ×${r.qty}`
                        : ""}
                  </strong>
                  <div className="badge">
                    {r.cheaper === "walmart"
                      ? "Walmart cheaper"
                      : r.cheaper === "nofrills"
                        ? "No Frills cheaper"
                        : r.cheaper === "tie"
                          ? "Tie"
                          : r.fairBasis === "incomparable"
                            ? "Incomparable"
                            : "Incomplete"}
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
              </div>
            </article>
          ))}

          {totals && totals.completeCount > 0 && (
            <div className="totals">
              <div>
                Walmart basket: <strong>${totals.walmart.toFixed(2)}</strong>
              </div>
              <div>
                No Frills basket: <strong>${totals.noFrills.toFixed(2)}</strong>
              </div>
              <div className="winner">
                {totals.cheaper === "walmart"
                  ? "Cheaper overall: Walmart"
                  : totals.cheaper === "nofrills"
                    ? "Cheaper overall: No Frills"
                    : "Overall: tie"}
              </div>
              {totals.note && <div className="tiny mute">{totals.note}</div>}
            </div>
          )}
        </section>
      )}

      {logPreview && (
        <section className="log">
          <h2>Останній лог матчів</h2>
          <pre>{JSON.stringify(logPreview, null, 2)}</pre>
        </section>
      )}

      <style jsx>{`
        .staples {
          font-family: "Segoe UI", "Candara", "Gill Sans", sans-serif;
          color: #1c1914;
          max-width: 960px;
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
        .hide-card {
          position: absolute;
          top: 0.35rem;
          left: 0.35rem;
          z-index: 2;
          width: 1.45rem;
          height: 1.45rem;
          border: 0;
          border-radius: 2px;
          background: rgba(40, 30, 28, 0.72);
          color: #fff;
          font-size: 1.15rem;
          line-height: 1;
          cursor: pointer;
          display: grid;
          place-items: center;
          padding: 0;
        }
        .hide-card:hover {
          background: #8b2e2e;
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
          width: 1.85rem;
          height: 1.85rem;
          border: 1px solid rgba(30, 40, 30, 0.25);
          background: #fff;
          cursor: pointer;
          font-size: 1.05rem;
          line-height: 1;
          padding: 0;
        }
        .qty-unit {
          opacity: 0.7;
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
          grid-template-columns: 1fr 1fr;
          gap: 0.75rem;
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
      `}</style>
    </div>
  );
}

function Side({
  title,
  side,
  grams,
  qty,
}: {
  title: string;
  side: SideResult;
  grams?: number | null;
  qty?: number;
}) {
  const buy = side.purchase;
  const productName = side.name ?? buy?.name ?? null;
  // Only this store's offer photo — never the shared staple / other column.
  const productImage = side.image ?? null;
  const usable =
    side.lineTotal != null &&
    (side.status === "ok" || side.status === "stale" || !side.status);
  const byWeight = side.nativeUnitPrice != null && side.nativeUnit != null;
  const scaled =
    grams != null &&
    grams > 0 &&
    side.pricePerKg != null &&
    (side.status === "ok" || side.status === "stale" || !side.status)
      ? side.pricePerKg * (grams / 1000)
      : null;
  const packQty = qty != null && qty > 1 ? qty : null;
  const primary =
    buy != null
      ? buy.totalPrice
      : scaled != null
        ? scaled
        : packQty != null && side.lineTotal != null
          ? side.lineTotal
          : byWeight
            ? side.nativeUnitPrice!
            : (side.lineTotal ?? null);
  const unitLabel =
    buy != null
      ? buy.soldByWeight
        ? `за ${buy.neededGrams} g`
        : `${buy.packs} × ${buy.packGrams} g`
      : scaled != null
        ? `за ${grams} g`
        : packQty != null
          ? `×${packQty}`
          : byWeight
            ? (side.nativeUnitLabel ?? side.compareUnitLabel ?? null)
            : (side.compareUnitLabel ?? null);
  const otherUnit =
    byWeight && side.nativeUnit === "kg" && side.pricePerLb != null
      ? `= $${side.pricePerLb.toFixed(2)} / lb`
      : byWeight && side.nativeUnit === "lb" && side.pricePerKg != null
        ? `= $${side.pricePerKg.toFixed(2)} / kg`
        : null;

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
      {usable && primary != null ? (
        <>
          <div className="big">${primary.toFixed(2)}</div>
          {unitLabel && <div className="unit">{unitLabel}</div>}
          {otherUnit && <div className="tiny mute">{otherUnit}</div>}
          {byWeight &&
            side.shelfPrice != null &&
            side.nativeUnitPrice != null &&
            Math.abs(side.shelfPrice - side.nativeUnitPrice) > 0.005 && (
              <div className="tiny mute">
                полиця ${side.shelfPrice.toFixed(2)}
              </div>
            )}
          {buy && (
            <>
              <div className="tiny">потрібно {buy.neededGrams} g</div>
              {buy.soldByWeight ? (
                <div className="tiny mute">на вагу, без пачки</div>
              ) : (
                <>
                  <div className="tiny">
                    пачка {buy.packGrams} g · {buy.packs} шт · разом {buy.gotGrams} g
                  </div>
                  <div className="tiny mute">
                    {buy.deltaGrams === 0
                      ? "без відхилення"
                      : buy.deltaGrams < 0
                        ? `недостача ${Math.abs(buy.deltaGrams)} g (${Math.abs(buy.deltaPct)}%)`
                        : `надлишок ${buy.deltaGrams} g (+${buy.deltaPct}%)`}
                    {buy.coverFallback ? " · перевищує бажану кількість" : ""}
                  </div>
                </>
              )}
              <div className="tiny mute">
                ${buy.pricePer100g.toFixed(2)}/100g
              </div>
            </>
          )}
          {side.note && <div className="tiny mute">{side.note}</div>}
          {side.ageLabel && (
            <div className="tiny mute">
              {"\u0446\u0456\u043d\u0430 \u0432\u0456\u0434 "}
              {side.ageLabel}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mute">немає порівнянної ціни</div>
          {side.statusReason && (
            <div className="tiny mute">{side.statusReason}</div>
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
