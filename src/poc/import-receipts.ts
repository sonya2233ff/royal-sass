/**
 * Import cafe receipt lines → data/catalog/receipt_sku_map.json
 *
 * CSV columns (header required):
 *   date, store, upc, name, qty, unit_price, line_total
 * Optional: product_id, retailer, package_size
 *
 * Usage:
 *   npx tsx src/poc/import-receipts.ts data/receipts/sample.csv
 *   npx tsx src/poc/import-receipts.ts data/receipts/*.csv
 */
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

export interface ReceiptSkuEntry {
  upc: string;
  store: string;
  retailer?: string;
  name: string;
  packageSize?: string;
  preferredProductId?: string;
  lastUnitPrice: number;
  lastLineTotal?: number;
  lastQty?: number;
  lastSeenAt: string;
  purchaseCount: number;
  /** Most common name seen for this UPC+store */
  names: Record<string, number>;
}

export type ReceiptSkuMap = {
  updatedAt: string;
  sourceFiles: string[];
  /** key = `${store}::${upc}` */
  byStoreUpc: Record<string, ReceiptSkuEntry>;
  /** stapleId → preferred locks derived from UPCs / product_ids */
  preferredByStapleId: Record<
    string,
    { productId?: string; upc?: string; store: string; name: string }
  >;
};

const STAPLE_UPC_HINTS: Record<string, string[]> = {
  simply_egg_whites: ["065651002470", "6565100247"],
  tomatoes_grape: ["628915235420", "628915485012"],
  eggs_30ct: ["627735279720"],
  grayridge_eggs: ["064767343050"],
  lemons_2lb: ["033383119060"],
  pear_bosc_kg: ["0000000044130", "44130"],
  folgers_coffee: ["082785400724"],
  eggplant_kg: ["4081"],
  tomato_gh_red_kg: ["4799"],
  rogers_wheat_bran: ["006017911015"],
  oat_beverage_original: ["628915220001"],
  red_peppers_kg: ["46880", "46830"],
  sweet_potatoes_kg: ["060383689012"],
  milk_2pct_2l: ["068700101234"],
  homo_milk_2l: [],
};

function parseCsv(text: string): Record<string, string>[] {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]!).map((h) => h.trim().toLowerCase());
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (cols[i] ?? "").trim();
    });
    rows.push(row);
  }
  return rows;
}

/** Minimal CSV splitter (handles quoted commas). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
      continue;
    }
    if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function normUpc(u: string): string {
  const digits = u.replace(/\D/g, "");
  return digits || u.trim();
}

function keyFor(store: string, upc: string): string {
  return `${store}::${normUpc(upc)}`;
}

export function aggregateReceiptRows(
  rows: Record<string, string>[],
  existing?: ReceiptSkuMap,
): ReceiptSkuMap {
  const byStoreUpc: Record<string, ReceiptSkuEntry> = {
    ...(existing?.byStoreUpc ?? {}),
  };

  for (const r of rows) {
    const upc = (r.upc ?? "").trim();
    const store = (r.store ?? "").trim();
    const name = (r.name ?? "").trim();
    if (!upc || !store || !name) continue;

    const unit = Number.parseFloat(r.unit_price || r.price || "");
    if (!Number.isFinite(unit) || unit <= 0) continue;

    const k = keyFor(store, upc);
    const prev = byStoreUpc[k];
    const date = (r.date ?? "").trim() || new Date().toISOString().slice(0, 10);
    const qty = Number.parseFloat(r.qty || "1") || 1;
    const line = Number.parseFloat(r.line_total || "") || unit * qty;
    const productId = (r.product_id ?? r.productid ?? "").trim() || undefined;
    const retailer = (r.retailer ?? "").trim() || undefined;
    const packageSize = (r.package_size ?? r.pack ?? "").trim() || undefined;

    if (!prev) {
      byStoreUpc[k] = {
        upc: normUpc(upc),
        store,
        retailer,
        name,
        packageSize,
        preferredProductId: productId,
        lastUnitPrice: unit,
        lastLineTotal: line,
        lastQty: qty,
        lastSeenAt: date,
        purchaseCount: 1,
        names: { [name]: 1 },
      };
      continue;
    }

    prev.purchaseCount += 1;
    prev.names[name] = (prev.names[name] ?? 0) + 1;
    if (date >= prev.lastSeenAt) {
      prev.lastSeenAt = date;
      prev.lastUnitPrice = unit;
      prev.lastLineTotal = line;
      prev.lastQty = qty;
      prev.name = name;
      if (packageSize) prev.packageSize = packageSize;
      if (productId) prev.preferredProductId = productId;
      if (retailer) prev.retailer = retailer;
    } else if (productId && !prev.preferredProductId) {
      prev.preferredProductId = productId;
    }
  }

  // Prefer most common name
  for (const e of Object.values(byStoreUpc)) {
    let best = e.name;
    let n = 0;
    for (const [nm, c] of Object.entries(e.names)) {
      if (c > n) {
        n = c;
        best = nm;
      }
    }
    e.name = best;
  }

  const preferredByStapleId: ReceiptSkuMap["preferredByStapleId"] = {
    ...(existing?.preferredByStapleId ?? {}),
  };

  for (const [stapleId, upcs] of Object.entries(STAPLE_UPC_HINTS)) {
    const norms = upcs.map(normUpc);
    const candidates = Object.values(byStoreUpc).filter((e) =>
      norms.includes(e.upc),
    );
    // Prefer Walmart store rows with product_id
    candidates.sort((a, b) => {
      const aWm = a.store.includes("walmart") ? 1 : 0;
      const bWm = b.store.includes("walmart") ? 1 : 0;
      if (bWm !== aWm) return bWm - aWm;
      if (Boolean(b.preferredProductId) !== Boolean(a.preferredProductId)) {
        return a.preferredProductId ? -1 : 1;
      }
      return b.purchaseCount - a.purchaseCount;
    });
    const best = candidates[0];
    if (best) {
      preferredByStapleId[stapleId] = {
        productId: best.preferredProductId,
        upc: best.upc,
        store: best.store,
        name: best.name,
      };
    }
  }

  return {
    updatedAt: new Date().toISOString(),
    sourceFiles: existing?.sourceFiles ?? [],
    byStoreUpc,
    preferredByStapleId,
  };
}

async function resolveInputs(args: string[]): Promise<string[]> {
  if (!args.length) {
    return [path.join(process.cwd(), "data", "receipts", "sample.csv")];
  }
  const out: string[] = [];
  for (const a of args) {
    if (a.includes("*")) {
      const dir = path.dirname(a);
      const files = await readdir(dir);
      const re = new RegExp(
        "^" + path.basename(a).replace(/\./g, "\\.").replace(/\*/g, ".*") + "$",
      );
      for (const f of files) {
        if (re.test(f)) out.push(path.join(dir, f));
      }
    } else {
      out.push(path.resolve(a));
    }
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const fresh = argv.includes("--fresh");
  const files = await resolveInputs(argv.filter((a) => a !== "--fresh"));
  const outPath = path.join(
    process.cwd(),
    "data",
    "catalog",
    "receipt_sku_map.json",
  );

  let map: ReceiptSkuMap | undefined;
  if (!fresh) {
    try {
      map = JSON.parse(await readFile(outPath, "utf8")) as ReceiptSkuMap;
    } catch {
      map = undefined;
    }
  }

  const sourceFiles = fresh ? [] : [...(map?.sourceFiles ?? [])];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const rows = parseCsv(text);
    console.log(`read ${file}: ${rows.length} rows`);
    map = aggregateReceiptRows(rows, fresh ? undefined : map);
    if (!sourceFiles.includes(file)) sourceFiles.push(file);
  }
  if (!map) throw new Error("no rows imported");
  map.sourceFiles = sourceFiles;

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(map, null, 2), "utf8");
  console.log(
    `wrote ${outPath} entries=${Object.keys(map.byStoreUpc).length} staples=${Object.keys(map.preferredByStapleId).length}`,
  );
  console.log(JSON.stringify(map.preferredByStapleId, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
