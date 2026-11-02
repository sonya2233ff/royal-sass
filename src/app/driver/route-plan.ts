export type StoreId = "walmart" | "nofrills" | "mvr";

export type Geo = { lat: number; lng: number };

export type StoreInfo = Geo & {
  id: StoreId;
  name: string;
  address: string;
};

/** Where the driver starts and returns (the café). */
export const CAFE = {
  name: "Royal SASS Café",
  address: "10 Disera Dr Unit 100, Thornhill, ON L4J 0A7",
  // Building pin for 10 Disera Dr (SmartCentres Thornhill / L4J 0A7).
  lat: 43.81035,
  lng: -79.45394,
};

export const STORES: Record<StoreId, StoreInfo> = {
  walmart: {
    id: "walmart",
    name: "Walmart #5831",
    address: "700 Centre St, Thornhill, ON L4J 0A7",
    lat: 43.81163,
    lng: -79.45116,
  },
  nofrills: {
    id: "nofrills",
    name: "No Frills #3660",
    // Anthony's No Frills — NOT Bathurst (that was a wrong pin).
    address: "1054 Centre St, Vaughan, ON L4J 3M8",
    lat: 43.81005,
    lng: -79.46039,
  },
  mvr: {
    id: "mvr",
    name: "MVR Cash & Carry",
    address: "3655 Weston Rd, North York, ON M9L 1V8",
    lat: 43.76054,
    lng: -79.54299,
  },
};

export const STORE_ORDER: StoreId[] = ["walmart", "nofrills", "mvr"];

/** Fuel/vehicle cost per km and the flat driver salary per run. */
export const PER_KM = 0.62;
export const DRIVER_SALARY = 20;

/**
 * Mock per-unit shelf prices. Missing store key = not stocked there
 * (e.g. No-Hole Dome Lids are MVR-only — not at No Frills).
 */
type StorePrices = Partial<Record<StoreId, number>>;

const PRICES: Record<string, StorePrices> = {
  large_eggs_dozen: { walmart: 6.29, nofrills: 5.99, mvr: 5.49 },
  simply_egg_whites: { walmart: 9.47, nofrills: 10.49 },
  tomatoes_grape: { walmart: 4.39, nofrills: 3.99, mvr: 3.79 },
  lemons_2lb: { walmart: 3.99, nofrills: 3.49, mvr: 3.29 },
  milk_2pct_2l: { walmart: 4.49, nofrills: 4.79 },
  homo_milk_2l: { walmart: 4.97, nofrills: 5.29 },
  butter_454g: { walmart: 5.99, nofrills: 5.49 },
  orange_juice_pulp: { walmart: 6.97, nofrills: 7.49 },
  ice_cubes: { walmart: 2.99, nofrills: 3.29 },
  ziploc_sandwich: { walmart: 3.99, nofrills: 4.29, mvr: 3.49 },
  strawberries: { walmart: 3.99, nofrills: 3.5, mvr: 3.29 },
  // Cafe supplies — MVR Weston shelf (NF/WM often no_match).
  lids_dome_no_hole: { mvr: 2.19 },
  lids_dome_12_24oz: { mvr: 66.49 },
  cups_12oz_squat_pet: { mvr: 5.19 },
  cups_16oz_pet: { mvr: 5.49 },
  cups_12oz_black_ripple: { mvr: 5.49 },
  cups_16oz_black_ripple: { mvr: 5.99 },
  lids_bagasse_bowl: { mvr: 6.49 },
  lids_deli_round: { mvr: 3.29 },
};

/** Defaults only for staples with no explicit row (typical grocery). */
const DEFAULT_PRICE: StorePrices = { walmart: 4.99, nofrills: 4.79, mvr: 4.49 };

/** Cafe supply / packaging ids that grocery stores usually do not carry. */
function looksLikeSupply(id: string): boolean {
  return /^(cups_|lids_|foil_|napkin|mitt|tray|platter|bagasse|guest_towel)/i.test(
    id,
  );
}

/** Shelf price, or null when that store does not stock the staple. */
export function priceOf(id: string, store: StoreId): number | null {
  const row = PRICES[id];
  if (row) {
    const hit = row[store];
    return typeof hit === "number" && Number.isFinite(hit) ? hit : null;
  }
  if (looksLikeSupply(id)) {
    return store === "mvr" ? (DEFAULT_PRICE.mvr ?? 4.49) : null;
  }
  const hit = DEFAULT_PRICE[store];
  return typeof hit === "number" ? hit : null;
}

export function availableStores(id: string): StoreId[] {
  return STORE_ORDER.filter((store) => priceOf(id, store) != null);
}

export function cheapestStore(id: string): StoreId {
  const opts = availableStores(id);
  if (!opts.length) return "mvr";
  return opts.reduce((best, store) => {
    const a = priceOf(id, store);
    const b = priceOf(id, best);
    if (a == null) return best;
    if (b == null) return store;
    return a < b ? store : best;
  });
}

/** Prefer one store when it stocks the item; else cheapest available. */
function assignPrefer(preferred: StoreId, id: string): StoreId {
  if (priceOf(id, preferred) != null) return preferred;
  return cheapestStore(id);
}

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

export function haversineKm(a: Geo, b: Geo): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type Stop = Geo & { name: string; address: string };

export type PlanItem = {
  id: string;
  qty: number;
  store: StoreId;
  price: number;
  lineTotal: number;
};

export type Plan = {
  key: string;
  label: string;
  storeIds: StoreId[];
  /** café → stores (nearest-first) → café */
  stops: Stop[];
  items: PlanItem[];
  productCost: number;
  distanceKm: number;
  drivingCost: number;
  salary: number;
  total: number;
};

/** Greedy nearest-neighbour route café → stores → café. */
function routeThrough(stores: StoreInfo[]): { km: number; ordered: StoreInfo[] } {
  const remaining = [...stores];
  const ordered: StoreInfo[] = [];
  let cur: Geo = CAFE;
  let km = 0;
  while (remaining.length) {
    let best = 0;
    for (let i = 1; i < remaining.length; i += 1) {
      if (haversineKm(cur, remaining[i]) < haversineKm(cur, remaining[best])) {
        best = i;
      }
    }
    km += haversineKm(cur, remaining[best]);
    cur = remaining[best];
    ordered.push(remaining[best]);
    remaining.splice(best, 1);
  }
  km += haversineKm(cur, CAFE);
  return { km, ordered };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export type Basket = { id: string; qty: number }[];

function buildPlan(
  key: string,
  label: string,
  basket: Basket,
  assign: (id: string) => StoreId,
): Plan {
  const items: PlanItem[] = basket.map((b) => {
    const store = assign(b.id);
    const price = priceOf(b.id, store) ?? priceOf(b.id, cheapestStore(b.id)) ?? 0;
    return { id: b.id, qty: b.qty, store, price, lineTotal: round2(price * b.qty) };
  });
  const productCost = round2(items.reduce((s, i) => s + i.lineTotal, 0));
  const storeIds = [...new Set(items.map((i) => i.store))] as StoreId[];
  const { km, ordered } = routeThrough(storeIds.map((id) => STORES[id]));
  const distanceKm = Math.round(km * 10) / 10;
  const drivingCost = round2(distanceKm * PER_KM);
  const salary = DRIVER_SALARY;
  const total = round2(productCost + drivingCost + salary);
  const stops: Stop[] = [
    { name: CAFE.name, address: CAFE.address, lat: CAFE.lat, lng: CAFE.lng },
    ...ordered.map((s) => ({
      name: s.name,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
    })),
    { name: CAFE.name, address: CAFE.address, lat: CAFE.lat, lng: CAFE.lng },
  ];
  return {
    key,
    label,
    storeIds,
    stops,
    items,
    productCost,
    distanceKm,
    drivingCost,
    salary,
    total,
  };
}

export function computePlans(basket: Basket): {
  plans: Plan[];
  recommended: Plan | null;
} {
  if (!basket.length) return { plans: [], recommended: null };
  const plans: Plan[] = [
    buildPlan("all-walmart", "Усе в Walmart", basket, (id) =>
      assignPrefer("walmart", id),
    ),
    buildPlan("all-nofrills", "Усе в No Frills", basket, (id) =>
      assignPrefer("nofrills", id),
    ),
    buildPlan("all-mvr", "Усе в MVR", basket, (id) => assignPrefer("mvr", id)),
    buildPlan("cheapest", "Найдешевше по товарах", basket, cheapestStore),
  ];
  // Best option for the driver = shortest route (km). Fewer stops break ties.
  // Product $ / salary / road $ do not pick the recommended plan.
  const recommended = plans.reduce((best, p) => {
    if (p.distanceKm < best.distanceKm) return p;
    if (
      p.distanceKm === best.distanceKm &&
      p.storeIds.length < best.storeIds.length
    ) {
      return p;
    }
    return best;
  }, plans[0]);
  return {
    plans: plans.sort(
      (a, b) =>
        a.distanceKm - b.distanceKm || a.storeIds.length - b.storeIds.length,
    ),
    recommended,
  };
}

export type MapProvider = "google" | "waze" | "apple";

/** Prefer street address so Maps geocodes the store, not a nearby wrong pin. */
function stopQuery(stop: Stop): string {
  return stop.address.trim() || `${stop.lat},${stop.lng}`;
}

/** Deep-link into a maps app with the café → stores → café route. */
export function mapUrl(provider: MapProvider, stops: Stop[]): string {
  if (!stops.length) return "https://www.google.com/maps";
  const queries = stops.map(stopQuery);
  if (provider === "google") {
    const origin = encodeURIComponent(queries[0]);
    const destination = encodeURIComponent(queries[queries.length - 1]);
    const mid = queries.slice(1, -1);
    let url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${origin}&destination=${destination}`;
    if (mid.length) {
      url += `&waypoints=${encodeURIComponent(mid.join("|"))}`;
    }
    return url;
  }
  if (provider === "apple") {
    const saddr = encodeURIComponent(queries[0]);
    const daddr = queries
      .slice(1)
      .map((q) => encodeURIComponent(q))
      .join("+to:");
    return `https://maps.apple.com/?dirflg=d&saddr=${saddr}&daddr=${daddr}`;
  }
  // Waze supports a single destination — navigate to the first store by address.
  const target = stops[1] ?? stops[stops.length - 1];
  return `https://waze.com/ul?q=${encodeURIComponent(stopQuery(target))}&navigate=yes`;
}

export function money(n: number): string {
  return `$${n.toFixed(2)}`;
}
