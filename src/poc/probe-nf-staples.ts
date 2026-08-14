import {
  loadStaplesConfig,
  searchNoFrills,
  summarizeOffer,
  type MatchLogEntry,
} from "@/lib/staples";

async function main() {
  const cfg = await loadStaplesConfig();
  for (const id of ["simply_egg_whites", "tomatoes", "red_peppers"]) {
    const item = cfg.items.find((i) => i.id === id)!;
    const log: MatchLogEntry = {
      at: new Date().toISOString(),
      itemId: id,
      retailer: "no_frills",
      queries: [],
      rejected: [],
      status: "no_match",
    };
    const o = await searchNoFrills(item, log);
    const sum = summarizeOffer(
      item,
      o
        ? {
            name: o.name,
            price: o.price,
            productId: o.productId,
            packageSize: o.packageSize,
            unitPrice: o.unitPrice,
            checkedAt: o.checkedAt,
          }
        : null,
    );
    if (sum) {
      console.log(
        id,
        "NF",
        sum.status,
        sum.compareUnitLabel,
        `$${sum.lineTotal}`,
        "|",
        sum.name?.slice(0, 60),
      );
    } else {
      console.log(
        id,
        "NF none",
        log.status,
        log.rejected.at(-1)?.reason ?? "-",
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
