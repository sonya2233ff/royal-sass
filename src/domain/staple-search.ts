/**
 * Homepage search: only staples the operator already sees.
 * Never ranks retailer titles (a foam pumpkin on a wraps SKU must not
 * appear for "pumpkin") and never live-searches WM / NF / WC / MVR.
 */
import { nameMatchesFilterPhrase } from "@/domain/catalog-normalize";
import { queryLooksLikeShellEggs } from "@/domain/egg-pack";

export type CatalogSearchItem = {
  id: string;
  label: string;
  queries?: string[];
  mustIncludeAny?: string[];
  mustIncludeAll?: string[];
  searchHay?: string;
};

export function catalogSearchHay(item: CatalogSearchItem): string {
  if (item.searchHay?.trim()) return item.searchHay.toLowerCase();
  return [
    item.label,
    item.id.replace(/_/g, " "),
    ...(item.queries ?? []),
    ...(item.mustIncludeAny ?? []),
    ...(item.mustIncludeAll ?? []),
  ]
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function stapleMatchesCatalogQuery(
  item: CatalogSearchItem,
  query: string,
): boolean {
  const q = query.trim();
  if (!q) return true;
  if (queryLooksLikeShellEggs(q)) {
    return item.id === "large_eggs_dozen";
  }
  const hay = catalogSearchHay(item);
  const needle = q.toLowerCase();
  if (!hay) return false;
  if (hay.includes(needle)) return true;
  const parts = needle.split(/\s+/).filter((p) => p.length >= 2);
  if (parts.length > 1 && parts.every((p) => hay.includes(p))) return true;
  return nameMatchesFilterPhrase(hay, needle, true);
}

export function catalogSearchScore(item: CatalogSearchItem, query: string): number {
  const q = query.trim().toLowerCase();
  const label = item.label.toLowerCase();
  if (!q) return 0;
  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  if (label.includes(q)) return 60;
  if (item.id.replace(/_/g, " ").includes(q)) return 40;
  return 20;
}

export function searchShownCatalog<T extends CatalogSearchItem>(
  items: T[],
  query: string,
  limit = 12,
): T[] {
  const q = query.trim();
  if (q.length < 2) return [];
  return items
    .filter((item) => stapleMatchesCatalogQuery(item, q))
    .sort((a, b) => {
      const d = catalogSearchScore(b, q) - catalogSearchScore(a, q);
      return d !== 0 ? d : a.label.localeCompare(b.label);
    })
    .slice(0, limit);
}
