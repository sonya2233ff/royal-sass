/**
 * Live No Frills (PCX BFF) search probe.
 *
 * Usage:
 *   npm run probe:nofrills -- "bananas"
 *   npm run probe:nofrills -- "mehadrin milk" --raw
 *   npm run probe:nofrills -- "egg whites" --store 3660
 */
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { probeNoFrillsSearch } from "@/connectors/nofrills";

async function main() {
  const args = process.argv.slice(2);
  const raw = args.includes("--raw");
  const storeIdx = args.indexOf("--store");
  const storeId =
    storeIdx >= 0 ? args[storeIdx + 1] : (process.env.NOFRILLS_STORE_ID ?? "3660");
  const query = args.filter((a, i) => {
    if (a === "--raw") return false;
    if (a === "--store") return false;
    if (storeIdx >= 0 && i === storeIdx + 1) return false;
    return true;
  })[0];

  if (!query) {
    console.error(
      'Usage: npm run probe:nofrills -- "bananas" [--raw] [--store 3660]',
    );
    process.exit(1);
  }

  const result = await probeNoFrillsSearch({
    query,
    storeId,
    includeRaw: raw,
    rawLimit: 8,
  });

  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        query: result.query,
        storeId: result.storeId,
        httpStatus: result.httpStatus,
        originTried: result.originTried,
        cookieCount: result.cookieCount ?? 0,
        retriedWithCookies: result.retriedWithCookies ?? false,
        ms: result.ms,
        tileCount: result.tileCount,
        mappedCount: result.mappedCount,
        error: result.error,
        offers: result.offers.map((o) => ({
          productId: o.productId,
          name: o.name,
          price: o.price,
          unitPrice: o.unitPrice,
          packageSize: o.packageSize,
          sourceUrl: o.sourceUrl,
        })),
      },
      null,
      2,
    ),
  );

  const outDir = path.join(process.cwd(), "data", "catalog");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "nofrills_probe_latest.json");
  await writeFile(outPath, JSON.stringify(result, null, 2), "utf8");
  console.error(`\nWrote ${outPath}`);

  if (!result.ok) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
