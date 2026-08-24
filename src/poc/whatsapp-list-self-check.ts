/**
 * WhatsApp paste → existing Master Products (no new staples, no retailer rematch).
 *   npx tsx src/poc/whatsapp-list-self-check.ts
 */
import { catalogSearchHay } from "@/domain/staple-search";
import { toRestaurantProduct } from "@/domain/restaurant-product";
import {
  applyWhatsAppAiHint,
  foldWhatsAppQuery,
  parseWhatsAppList,
  parseWhatsAppRawLine,
  toWaiterLinesFromWhatsApp,
} from "@/domain/whatsapp-list";
import { isShownStaple, isSoldByWeightItem, loadStaplesConfig } from "@/lib/staples";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const cfg = await loadStaplesConfig();
  const catalog = cfg.items.filter(isShownStaple).map((item) => {
    const product = toRestaurantProduct({
      ...item,
      soldByWeight: isSoldByWeightItem(item),
    });
    return {
      id: item.id,
      label: item.label,
      queries: item.queries,
      mustIncludeAny: item.mustIncludeAny,
      mustIncludeAll: item.mustIncludeAll,
      searchHay: catalogSearchHay(item),
      unit: product.unit,
      defaultAmount: product.defaultAmount,
      soldByWeight: isSoldByWeightItem(item),
      category: item.category,
    };
  });

  assert(
    foldWhatsAppQuery("фрозен блуперіс") === "frozen blueberries",
    `fold ${foldWhatsAppQuery("фрозен блуперіс")}`,
  );

  const twoMilk = parseWhatsAppRawLine("2 milk");
  assert(twoMilk?.query === "milk", twoMilk?.query);
  assert(twoMilk?.qty === 2, `milk qty ${twoMilk?.qty}`);

  const tomato = parseWhatsAppRawLine("tomato 5kg");
  assert(tomato?.query === "tomato", tomato?.query);
  assert(tomato?.unit === "kg", tomato?.unit);
  assert(tomato?.requestedAmount === 5, `tomato kg ${tomato?.requestedAmount}`);

  const whites = parseWhatsAppRawLine("egg whites x2");
  assert(whites?.query === "egg whites", whites?.query);
  assert(whites?.qty === 2, `whites qty ${whites?.qty}`);

  const SAMPLE = `
2 milk
frozen blueberries
фрозен блуперіс 2
egg whites x2
tomato 5kg
ще 2 milk
  `;
  const parsed = parseWhatsAppList(SAMPLE, catalog);
  const byQuery = new Map(parsed.decisions.map((d) => [d.query, d]));

  const milk = byQuery.get("milk");
  assert(milk, "merged milk");
  assert(milk?.qty === 4, `milk merged qty ${milk?.qty}`);
  assert(
    milk?.status === "unsure" ||
      milk?.alternatives.some((a) => a.id === "milk_2pct_2l"),
    "milk stays unsure or lists 2% (do not guess homo vs 2%)",
  );
  assert(
    milk?.alternatives.some((a) => a.id === "milk_2pct_2l"),
    "2% milk is an alternative",
  );
  assert(
    milk?.alternatives.some((a) => a.id === "homo_milk_2l"),
    "homo milk is an alternative",
  );

  const frozen = byQuery.get("frozen blueberries");
  assert(frozen?.status === "matched", frozen?.status);
  assert(frozen?.matchedId === "frozen_blueberry", frozen?.matchedId);
  assert(frozen?.qty === 3, `frozen qty ${frozen?.qty} (1+2)`);
  assert(frozen?.matchedId !== "blueberries", "frozen ≠ fresh blueberries");

  const eggWhite = byQuery.get("egg whites");
  assert(eggWhite?.matchedId === "simply_egg_whites", eggWhite?.matchedId);
  assert(eggWhite?.matchedId !== "large_eggs_dozen", "whites ≠ shell eggs");
  assert(eggWhite?.qty === 2, `whites ${eggWhite?.qty}`);

  const tom = byQuery.get("tomato");
  assert(tom?.matchedId === "tomato", tom?.matchedId);
  assert(tom?.matchedId !== "tomatoes_grape", "round tomato ≠ grape");
  assert(tom?.unit === "kg", tom?.unit);
  assert(tom?.requestedAmount === 5, `tomato need ${tom?.requestedAmount}`);

  const eggs = parseWhatsAppList("яйця\neggs", catalog);
  assert(
    eggs.decisions.every((d) => d.matchedId === "large_eggs_dozen"),
    "яйця / eggs → large_eggs_dozen",
  );

  const lines = toWaiterLinesFromWhatsApp([
    {
      id: "milk_2pct_2l",
      label: "Mehadrin 2% Milk 2L",
      qty: 4,
      unit: "pack",
      requestedAmount: 4,
    },
    {
      id: "tomato",
      label: "Tomato",
      qty: 5,
      unit: "kg",
      requestedAmount: 5,
    },
  ]);
  const milkLine = lines.find((l) => l.id === "milk_2pct_2l");
  const tomLine = lines.find((l) => l.id === "tomato");
  assert(milkLine?.qty === 4, `waiter milk qty ${milkLine?.qty}`);
  assert(tomLine?.qty === 1, `waiter tomato qty ${tomLine?.qty}`);
  assert(tomLine?.requestedAmount === 5, tomLine?.requestedAmount);
  assert(tomLine?.unit === "kg", tomLine?.unit);

  const hinted = applyWhatsAppAiHint(
    {
      raw: "молочко",
      query: "молочко",
      qty: 1,
      unit: "pack",
      requestedAmount: 1,
      status: "unmatched",
      alternatives: [],
    },
    "milk_2pct_2l",
    catalog,
    0.9,
  );
  assert(hinted.status === "matched", hinted.status);
  assert(hinted.matchedId === "milk_2pct_2l", hinted.matchedId);

  const refused = applyWhatsAppAiHint(
    {
      raw: "xyz",
      query: "xyz",
      qty: 1,
      unit: "pack",
      requestedAmount: 1,
      status: "unmatched",
      alternatives: [],
    },
    "not_a_real_id",
    catalog,
    0.99,
  );
  assert(refused.status === "unmatched", "AI cannot invent a Master Product");

  console.log("whatsapp-list-self-check: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
