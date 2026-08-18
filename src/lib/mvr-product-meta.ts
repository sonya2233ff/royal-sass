/**
 * MVR Plus Shopify fields used for matching. Cafe staple `category` is not
 * evidence that the retailer product is frozen/produce — use type + tags.
 */
export function mvrRetailerFilterText(offer: { raw?: unknown }): string {
  const parts = [productType(offer.raw)];
  for (const tag of tagList(offer.raw)) {
    if (
      /^(INSTOREPRICE|MARKUP|MARGIN|LASTUPDATED|SHELFLOCATION|TAXLEVEL):/i.test(
        tag,
      )
    ) {
      continue;
    }
    parts.push(
      tag
        .replace(/^(DEPARTMENT|CATEGORY|SUBDEPARTMENT)_/i, " ")
        .replace(/[_]/g, " "),
    );
  }
  return parts.filter(Boolean).join(" ");
}

export function mvrRetailerCategory(
  offer: { raw?: unknown },
): "frozen" | "produce" | undefined {
  const hay = mvrRetailerFilterText(offer).toLowerCase();
  if (/\bfrozen\b/.test(hay)) return "frozen";
  if (/\b(fruit|fruits|vegetable|vegetables|produce)\b/.test(hay)) {
    return "produce";
  }
  return undefined;
}

function tagList(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const tags = (raw as { tags?: unknown }).tags;
  if (Array.isArray(tags)) return tags.map(String);
  if (typeof tags === "string") {
    return tags.split(",").map((t) => t.trim()).filter(Boolean);
  }
  return [];
}

function productType(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const r = raw as { type?: unknown; product_type?: unknown };
  if (typeof r.type === "string" && r.type.trim()) return r.type;
  if (typeof r.product_type === "string" && r.product_type.trim()) {
    return r.product_type;
  }
  return "";
}
