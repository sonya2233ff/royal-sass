export type StoreId = "walmart" | "nofrills";

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
    address: "700 Centre St, Thornhill, ON",
    lat: 43.8169,
    lng: -79.4378,
  },
  nofrills: {
    id: "nofrills",
    name: "No Frills #3660",
    address: "3630 Bathurst St, Thornhill, ON",
    lat: 43.811,
    lng: -79.421,
  },
};

/** Fuel/vehicle cost per km and the flat driver salary per run. */
export const PER_KM = 0.62;
export const DRIVER_SALARY = 20;

/** Mock per-unit prices per store (same mock spirit as the rest of the app). */
const PRICES: Record<string, Record<StoreId, number>> = {
  large_eggs_dozen: { walmart: 6.29, nofrills: 5.99 },
  simply_egg_whites: { walmart: 9.47, nofrills: 10.49 },
  tomatoes_grape: { walmart: 4.39, nofrills: 3.99 },
  lemons_2lb: { walmart: 3.99, nofrills: 3.49 },
  milk_2pct_2l: { walmart: 4.49, nofrills: 4.79 },
  homo_milk_2l: { walmart: 4.97, nofrills: 5.29 },
  butter_454g: { walmart: 5.99, nofrills: 5.49 },
  orange_juice_pulp: { walmart: 6.97, nofrills: 7.49 },
  ice_cubes: { walmart: 2.99, nofrills: 3.29 },
  ziploc_sandwich: { walmart: 3.99, nofrills: 4.29 },
  strawberries: { walmart: 3.99, nofrills: 3.5 },
};
const DEFAULT_PRICE: Record<StoreId, number> = { walmart: 4.99, nofrills: 4.79 };

function priceOf(id: string, store: StoreId): number {
  return PRICES[id]?.[store] ?? DEFAULT_PRICE[store];
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
    const price = priceOf(b.id, store);
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
    buildPlan("all-walmart", "Усе в Walmart", basket, () => "walmart"),
    buildPlan("all-nofrills", "Усе в No Frills", basket, () => "nofrills"),
    buildPlan("cheapest", "Найдешевше по товарах", basket, (id) =>
      priceOf(id, "walmart") <= priceOf(id, "nofrills") ? "walmart" : "nofrills",
    ),
  ];
  const recommended = plans.reduce(
    (best, p) => (p.total < best.total ? p : best),
    plans[0],
  );
  return { plans: plans.sort((a, b) => a.total - b.total), recommended };
}

export type MapProvider = "google" | "waze" | "apple";

/** Deep-link into a maps app with the café → stores → café route. */
export function mapUrl(provider: MapProvider, stops: Stop[]): string {
  const pts = stops.map((s) => `${s.lat},${s.lng}`);
  if (provider === "google") {
    const origin = pts[0];
    const destination = pts[pts.length - 1];
    const waypoints = pts.slice(1, -1).join("|");
    let url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${origin}&destination=${destination}`;
    if (waypoints) url += `&waypoints=${encodeURIComponent(waypoints)}`;
    return url;
  }
  if (provider === "apple") {
    const saddr = pts[0];
    const daddr = pts.slice(1).join("+to:");
    return `https://maps.apple.com/?dirflg=d&saddr=${saddr}&daddr=${daddr}`;
  }
  // Waze supports a single destination — navigate to the first store.
  const target = stops[1] ?? stops[stops.length - 1];
  return `https://waze.com/ul?ll=${target.lat},${target.lng}&navigate=yes`;
}

export function money(n: number): string {
  return `$${n.toFixed(2)}`;
}
