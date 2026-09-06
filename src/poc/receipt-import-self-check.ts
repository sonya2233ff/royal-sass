/**
 * Receipt photo → catalog match / new custom staple drafts.
 *   npx tsx src/poc/receipt-import-self-check.ts
 */
import {
  customStapleId,
  decideManualProduct,
  decideReceiptLines,
  draftStapleFromManualName,
  draftStapleFromReceiptLine,
  isReceiptNoiseLine,
  parseReceiptText,
  receiptStapleId,
} from "@/domain/receipt-import";
import { catalogSearchHay } from "@/domain/staple-search";
import { parseCustomStapleDrafts } from "@/lib/product-config";
import { isShownStaple, loadStaplesConfig } from "@/lib/staples";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const SAMPLE = `
NO FRILLS #3660
HAOLAM RICOTTA CHEESE 6.99
LARGE EGGS 18 4.99
PAPER BAG 0.08
HST 0.91
TOTAL 12.97
VISA 12.97
`;

async function main() {
  const cfg = await loadStaplesConfig();
  const catalog = cfg.items.filter(isShownStaple).map((item) => ({
    id: item.id,
    label: item.label,
    queries: item.queries,
    mustIncludeAny: item.mustIncludeAny,
    mustIncludeAll: item.mustIncludeAll,
    searchHay: catalogSearchHay(item),
  }));

  assert(isReceiptNoiseLine("HST 0.91"), "HST is noise");
  assert(isReceiptNoiseLine("TOTAL 12.97"), "total is noise");

  const lines = parseReceiptText(SAMPLE);
  const names = lines.map((l) => l.name.toLowerCase());
  assert(
    names.some((n) => n.includes("ricotta")),
    `expected ricotta line, got ${names.join(" | ")}`,
  );
  assert(
    names.some((n) => n.includes("egg")),
    `expected eggs line, got ${names.join(" | ")}`,
  );
  assert(
    !names.some((n) => n.includes("paper bag")),
    "paper bag must be skipped",
  );
  assert(!names.some((n) => n.includes("hst")), "HST must be skipped");
  assert(!names.some((n) => n.includes("total")), "total must be skipped");

  const decisions = decideReceiptLines(lines, catalog);
  const ricotta = decisions.find((d) => /ricotta/i.test(d.name));
  const eggs = decisions.find((d) => /egg/i.test(d.name));
  assert(ricotta?.status === "existing", `ricotta status ${ricotta?.status}`);
  assert(
    ricotta?.matchedId === "haolam_ricotta_cheese",
    `ricotta matched ${ricotta?.matchedId}`,
  );
  assert(eggs?.status === "existing", `eggs status ${eggs?.status}`);
  assert(
    eggs?.matchedId === "large_eggs_dozen",
    `eggs matched ${eggs?.matchedId} (must not create a second egg card)`,
  );
  assert(
    !decisions.some((d) => d.status === "new" && /egg/i.test(d.name)),
    "must not draft a new egg staple",
  );

  const unknown = decideReceiptLines(
    [{ name: "ZYZZX QUANTUM MARSHMALLOW WHIP 900G", price: 11.11 }],
    catalog,
  );
  assert(unknown[0]?.status === "new", "unknown product becomes new");
  assert(unknown[0]?.draft?.custom === true, "new draft is custom");
  assert(
    unknown[0]?.draft?.id.startsWith("receipt_"),
    `id ${unknown[0]?.draft?.id}`,
  );
  assert(
    unknown[0]?.draft?.id === receiptStapleId(unknown[0]!.name),
    "id from receipt slug",
  );

  const collision = decideReceiptLines(
    [{ name: "ZYZZX QUANTUM MARSHMALLOW WHIP 900G" }],
    catalog,
    [unknown[0]!.draft!.id],
  );
  assert(
    collision[0]?.draft?.id !== unknown[0]?.draft?.id,
    "occupied receipt id gets a suffix",
  );

  const dairy = draftStapleFromReceiptLine({ name: "Haolam Something New 500g" });
  assert(dairy.matchMode === "exact", "branded dairy is Category A");
  const produce = draftStapleFromReceiptLine({ name: "Fresh cilantro bunch" });
  assert(
    produce.matchMode === "cheapest_equivalent",
    "produce from receipt is Category B",
  );

  const manualEggs = decideManualProduct({ label: "large eggs 18" }, catalog);
  assert(manualEggs.status === "eggs", `manual eggs ${manualEggs.status}`);
  assert(
    manualEggs.status === "eggs" && manualEggs.matchedId === "large_eggs_dozen",
    "homepage add must not create a second egg card",
  );

  const manualExisting = decideManualProduct(
    { label: "Haolam ricotta cheese" },
    catalog,
  );
  assert(
    manualExisting.status === "existing" &&
      manualExisting.matchedId === "haolam_ricotta_cheese",
    `manual existing ${manualExisting.status}`,
  );

  const tooShort = decideManualProduct({ label: "ab" }, catalog);
  assert(tooShort.status === "invalid", "short name is invalid");

  const manualNew = decideManualProduct(
    { label: "ZYZZX QUANTUM MARSHMALLOW WHIP 900G" },
    catalog,
  );
  assert(manualNew.status === "new", "unknown homepage name becomes new");
  assert(manualNew.status === "new" && manualNew.draft.custom === true);
  assert(
    manualNew.status === "new" &&
      manualNew.draft.id === customStapleId(manualNew.draft.label),
    `manual id ${manualNew.status === "new" ? manualNew.draft.id : ""}`,
  );

  const manualCollision = decideManualProduct(
    { label: "ZYZZX QUANTUM MARSHMALLOW WHIP 900G" },
    catalog,
    [manualNew.status === "new" ? manualNew.draft.id : ""],
  );
  assert(
    manualCollision.status === "new" &&
      manualNew.status === "new" &&
      manualCollision.draft.id !== manualNew.draft.id,
    "occupied custom id gets a suffix",
  );

  const dairyManual = draftStapleFromManualName({
    label: "Haolam Something New 500g",
  });
  assert(dairyManual.matchMode === "exact", "branded dairy homepage add is A");
  assert(dairyManual.id.startsWith("custom_"), dairyManual.id);

  const produceManual = draftStapleFromManualName({
    label: "Fresh cilantro bunch",
  });
  assert(
    produceManual.matchMode === "cheapest_equivalent",
    "produce homepage add is B",
  );

  const packInclude = draftStapleFromManualName({
    label: "ZYZZX Whip",
    mustIncludeAny: ["zyzzx", "2.63L", "900g"],
    mustNotInclude: ["imitation"],
  });
  assert(
    packInclude.mustIncludeAny?.some((t) => t.toLowerCase() === "zyzzx"),
    "include keeps brand token",
  );
  assert(
    !packInclude.mustIncludeAny?.some((t) => /2\.63|900/.test(t)),
    "pack size is not an include token",
  );
  assert(packInclude.mustNotInclude?.includes("imitation"), "exclude is kept");

  const extras = parseCustomStapleDrafts([
    { id: "large_eggs_dozen", label: "hack", queries: ["x"], custom: true },
    {
      id: "receipt_zyzzx_quantum_marshmallow_whip",
      label: "ZYZZX Quantum Marshmallow Whip",
      queries: ["zyzzx marshmallow"],
      custom: true,
      matchMode: "exact",
    },
    { id: "not_custom", label: "Nope", queries: ["nope"], custom: false },
  ]);
  assert(extras.length === 1, "only receipt_/custom_ drafts accepted");
  assert(extras[0]?.id.startsWith("receipt_"), extras[0]?.id);

  const customExtra = parseCustomStapleDrafts([
    {
      id: "custom_zyzzx_whip",
      label: "ZYZZX Whip",
      queries: ["zyzzx"],
      custom: true,
      matchMode: "exact",
    },
  ]);
  assert(customExtra.length === 1, "custom_ drafts accepted");
  assert(customExtra[0]?.id.startsWith("custom_"), customExtra[0]?.id);

  const withExtra = await loadStaplesConfig([...extras, ...customExtra]);
  assert(
    withExtra.items.some((i) => i.id === extras[0]!.id && i.custom === true),
    "client custom staple merges into config",
  );
  assert(
    withExtra.items.some((i) => i.id === customExtra[0]!.id && i.custom === true),
    "homepage custom_ staple merges into config",
  );

  console.log("receipt-import-self-check: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
