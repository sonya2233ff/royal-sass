import { catalogSearchHay } from "@/domain/staple-search";
import { toRestaurantProduct } from "@/domain/restaurant-product";
import type { ClientCustomStaple } from "@/lib/product-config";

export function customStaplePlaceholder(item: ClientCustomStaple) {
  return {
    id: item.id,
    label: item.label,
    image: null as string | null,
    searchHay: catalogSearchHay(item),
    queries: item.queries,
    mustIncludeAny: item.mustIncludeAny,
    mustIncludeAll: item.mustIncludeAll,
    notes: item.notes,
    status: "no_match" as const,
    statusReason: "ще без ціни в магазинах",
    custom: true as const,
    matchMode: item.matchMode,
    restaurantProduct: toRestaurantProduct(item),
    soldByWeight: false,
    walmartCached: null,
    noFrillsCached: null,
    wholesaleClubCached: null,
    mvrCached: null,
    sobeysCached: null,
  };
}

export function mergeServerItemsWithCustom<T extends { id: string }>(
  server: T[],
  extras: ClientCustomStaple[],
  removed: Iterable<string>,
): Array<T | ReturnType<typeof customStaplePlaceholder>> {
  const gone = new Set(removed);
  const seen = new Set(server.map((item) => item.id));
  const extraCards = extras
    .filter((item) => !seen.has(item.id) && !gone.has(item.id))
    .map(customStaplePlaceholder);
  return [...server, ...extraCards];
}
