/**
 * Download product photos for staples from Walmart / No Frills PDP og:image / CDN.
 * Updates config/cafe-staples.json image paths.
 *
 * Usage:
 *   npx tsx src/poc/fetch-product-images.ts
 *   npx tsx src/poc/fetch-product-images.ts frozen_blueberry acai
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "public", "products");

interface StapleItem {
  id: string;
  label: string;
  image?: string;
}

type CatalogRow = {
  id: string;
  offer?: { productId?: string; sourceUrl?: string; name?: string } | null;
};

async function loadJsonItems(rel: string): Promise<CatalogRow[]> {
  const raw = await readFile(path.join(process.cwd(), rel), "utf8");
  return JSON.parse(raw).items ?? [];
}

function extractImageUrl(html: string): string | null {
  const patterns = [
    /property="og:image"\s+content="([^"]+)"/i,
    /content="([^"]+)"\s+property="og:image"/i,
    /"imageUrl"\s*:\s*"(https:\\\/\\\/i5\.walmartimages[^"]+)"/i,
    /"(https:\/\/i5\.walmartimages\.ca\/[^"]+)"/i,
    /"(https:\/\/i5\.walmartimages\.com\/[^"]+)"/i,
    /"(https:\/\/assets\.shop\.loblaws\.ca\/[^"]+\.(?:png|jpg|jpeg|webp))"/i,
    /"(https:\/\/digital\.loblaws\.ca\/[^"]+\.(?:png|jpg|jpeg|webp))"/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      return m[1].replace(/\\\//g, "/").replace(/&amp;/g, "&");
    }
  }
  return null;
}

function loblawsCandidates(productId: string): string[] {
  const id = productId.replace(/_EA$/i, "");
  if (!/^\d+$/.test(id)) return [];
  const out: string[] = [];
  for (const brand of ["b2", "b1"]) {
    for (const variant of ["a06", "a01", "a02", "a03"]) {
      out.push(
        `https://assets.shop.loblaws.ca/products/${id}/${brand}/en/front/${id}_front_${variant}_@2.png`,
      );
    }
  }
  return out;
}

async function download(
  url: string,
  dest: string,
  referer?: string,
): Promise<boolean> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "image/jpeg,image/png,image/webp,image/*,*/*;q=0.8",
      Referer: referer ?? "https://www.walmart.ca/",
    },
    redirect: "follow",
  });
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 800) return false;
  await writeFile(dest, buf);
  return true;
}

async function imageFromPdp(sourceUrl: string): Promise<string | null> {
  const res = await fetch(sourceUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-CA,en;q=0.9",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    console.log(`  PDP HTTP ${res.status}`);
    return null;
  }
  const html = await res.text();
  return extractImageUrl(html);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const only = new Set(process.argv.slice(2).filter((a) => !a.startsWith("-")));
  const cfgPath = path.join(process.cwd(), "config", "cafe-staples.json");
  const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as {
    items: StapleItem[];
  };
  const wmCatalog = await loadJsonItems("data/catalog/walmart_5831_latest.json");
  const nfCatalog = await loadJsonItems(
    "data/catalog/nofrills_3660_latest.json",
  ).catch(() => [] as CatalogRow[]);
  const wmById = new Map(wmCatalog.map((c) => [c.id, c]));
  const nfById = new Map(nfCatalog.map((c) => [c.id, c]));

  // Remap existing photos onto renamed ids
  const aliases: Record<string, string> = {
    tomatoes_grape: "tomatoes.png",
    red_peppers_kg: "red_peppers.png",
    sweet_potatoes_kg: "sweet_potatoes.png",
    milk_2pct_2l: "mehadrin_2pct.jpg",
    milk_1pct_2l: "mehadrin_1pct.jpg",
    homo_milk_2l: "mehadrin_homo_3pct.png",
  };

  let ok = 0;
  let fail = 0;

  for (const item of cfg.items) {
    if (only.size && !only.has(item.id)) continue;

    const destJpg = path.join(OUT_DIR, `${item.id}.jpg`);
    const destPng = path.join(OUT_DIR, `${item.id}.png`);
    const wm = wmById.get(item.id);
    const nf = nfById.get(item.id);
    const sourceUrl = wm?.offer?.sourceUrl ?? nf?.offer?.sourceUrl;
    const nfProductId = nf?.offer?.productId;

    // Keep an already-correct dedicated photo (do not prefer {id}.jpg over it)
    if (item.image?.startsWith("/products/")) {
      const current = path.join(
        process.cwd(),
        "public",
        item.image.replace(/^\//, ""),
      );
      try {
        await readFile(current);
        console.log(`= ${item.id} (keep ${item.image})`);
        ok++;
        continue;
      } catch {
        /* missing */
      }
    }

    // Alias from older / brand-correct filenames
    const alias = aliases[item.id];
    if (alias) {
      try {
        const src = path.join(OUT_DIR, alias);
        await readFile(src);
        item.image = `/products/${alias}`;
        console.log(`~ ${item.id} using ${alias}`);
        ok++;
        continue;
      } catch {
        /* no alias file */
      }
    }

    // Keep existing dedicated file named after id
    try {
      await readFile(destJpg);
      item.image = `/products/${item.id}.jpg`;
      console.log(`= ${item.id} (have jpg)`);
      ok++;
      continue;
    } catch {
      /* missing */
    }
    try {
      await readFile(destPng);
      item.image = `/products/${item.id}.png`;
      console.log(`= ${item.id} (have png)`);
      ok++;
      continue;
    } catch {
      /* missing */
    }

    let saved = false;
    if (nfProductId && !wm?.offer?.sourceUrl) {
      for (const url of loblawsCandidates(nfProductId)) {
        console.log(`… ${item.id} trying NF CDN`);
        if (await download(url, destJpg, "https://www.nofrills.ca/")) {
          item.image = `/products/${item.id}.jpg`;
          console.log(`✓ ${item.id} ← ${url.slice(0, 90)}`);
          saved = true;
          break;
        }
      }
    }

    if (!saved && sourceUrl) {
      console.log(`… ${item.id} fetching PDP`);
      try {
        const imgUrl = await imageFromPdp(sourceUrl);
        if (imgUrl) {
          const referer = sourceUrl.includes("nofrills")
            ? "https://www.nofrills.ca/"
            : "https://www.walmart.ca/";
          saved = await download(imgUrl, destJpg, referer);
          if (saved) {
            item.image = `/products/${item.id}.jpg`;
            console.log(`✓ ${item.id} ← ${imgUrl.slice(0, 90)}`);
          } else {
            console.log(`✗ ${item.id} — download failed ${imgUrl.slice(0, 80)}`);
          }
        } else {
          console.log(`✗ ${item.id} — no image in PDP`);
        }
      } catch (e) {
        console.log(
          `✗ ${item.id} — ${e instanceof Error ? e.message.slice(0, 80) : e}`,
        );
      }
    }

    if (saved) ok++;
    else {
      if (!sourceUrl && !nfProductId) {
        console.log(`✗ ${item.id} — no sourceUrl (no_match?)`);
      }
      fail++;
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  await writeFile(cfgPath, JSON.stringify(cfg, null, 2), "utf8");

  // Mirror into catalog rows
  try {
    const catPath = path.join(
      process.cwd(),
      "data",
      "catalog",
      "walmart_5831_latest.json",
    );
    const catJson = JSON.parse(await readFile(catPath, "utf8"));
    for (const row of catJson.items) {
      const st = cfg.items.find((i) => i.id === row.id);
      if (st?.image) row.image = st.image;
    }
    await writeFile(catPath, JSON.stringify(catJson, null, 2), "utf8");
  } catch {
    /* ignore */
  }

  console.log(`\nDone ok=${ok} fail=${fail}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
