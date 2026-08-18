/**
 * Staple filters must use retailer type/tags, not title-only phrases.
 *   npx tsx src/poc/staple-filter-self-check.ts
 */
import { offerFailsStapleFilters } from "@/domain/catalog-normalize";
import { mvrRetailerFilterText } from "@/lib/mvr-product-meta";
import { loadStaplesConfig } from "@/lib/staples";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const alaskoRaw = {
  type: "FROZEN FRUITS",
  tags: [
    "CATEGORY_FROZEN FRUITS",
    "DEPARTMENT_FROZEN",
    "INSTOREPRICE:19.99",
    "MARKUP:1.1",
    "SUBDEPARTMENT_FROZEN FRUITS & VEGETABLES",
  ],
};

async function main() {
  const cfg = await loadStaplesConfig();
  const frozen = cfg.items.find((i) => i.id === "frozen_strawberry");
  const fresh = cfg.items.find((i) => i.id === "strawberries");
  const apple = cfg.items.find((i) => i.id === "frozen_apple");
  if (!frozen || !fresh || !apple) throw new Error("missing staples");

  const name = "ALASKO - STRAWBERRIES 5x1KG";
  const extra = mvrRetailerFilterText({ raw: alaskoRaw });

  assert(
    offerFailsStapleFilters(frozen, name, "ALASKO") === "mustIncludeAny",
    "title-only still requires frozen/sliced/whole in the name",
  );
  assert(
    offerFailsStapleFilters(frozen, name, "ALASKO", extra) == null,
    "Shopify DEPARTMENT_FROZEN + strawberries covers frozen strawberries",
  );
  assert(
    offerFailsStapleFilters(
      frozen,
      "Great Value Sliced Frozen Strawberries",
      "Great Value",
    ) == null,
    "grocery PDP title still matches without extra fields",
  );
  assert(
    offerFailsStapleFilters(fresh, name, "ALASKO", extra) ===
      "mustNotInclude:frozen",
    "fresh strawberry staple rejects frozen department",
  );
  assert(
    offerFailsStapleFilters(apple, "ALASKO - APPLE SLICES 5x1KG", "ALASKO") ===
      "mustIncludeAll:frozen",
    "frozen apple still needs frozen without tags",
  );
  assert(
    offerFailsStapleFilters(
      apple,
      "ALASKO - APPLE SLICES 5x1KG",
      "ALASKO",
      extra,
    ) == null,
    "frozen apple: DEPARTMENT_FROZEN satisfies mustIncludeAll frozen",
  );

  console.log("staple-filter-self-check ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
