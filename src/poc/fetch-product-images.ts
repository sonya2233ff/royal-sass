/**
 * Download product photos for staples from Walmart PDP og:image / CDN.
 * Updates config/cafe-staples.json image paths.
 *
 * Usage: npx tsx src/poc/fetch-product-images.ts
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "public", "products");

interface StapleItem {
  id: string;
  label: string;
  image?: string;
}

async function loadCatalog(): Promise<
  Array<{ id: string; offer?: { productId?: string; sourceUrl?: string; name?: string } | null }>
> {
  const raw = await readFile(
    path.join(process.cwd(), "data", "catalog", "walmart_5831_latest.json"),
    "utf8",
  );
  return JSON.parse(raw).items;
}

function extractImageUrl(html: string): string | null {
  const patterns = [
    /property="og:image"\s+content="([^"]+)"/i,
    /content="([^"]+)"\s+property="og:image"/i,
    /"imageUrl"\s*:\s*"(https:\\\/\\\/i5\.walmartimages[^"]+)"/i,
    /"(https:\/\/i5\.walmartimages\.ca\/[^"]+)"/i,
    /"(https:\/\/i5\.walmartimages\.com\/[^"]+)"/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      return m[1].replace(/\\\//g, "/").replace(/&amp;/g, "&");
    }
  }
  return null;
}

async function download(url: string, dest: string): Promise<boolean> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      Referer: "https://www.walmart.ca/",
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
  const cfgPath = path.join(process.cwd(), "config", "cafe-staples.json");
  const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as {
    items: StapleItem[];
  };
  const catalog = await loadCatalog();
  const byId = new Map(catalog.map((c) => [c.id, c]));

  // Remap existing photos onto renamed ids
  const aliases: Record<string, string> = {
    tomatoes_grape: "tomatoes.png",
    red_peppers_kg: "red_peppers.png",
    sweet_potatoes_kg: "sweet_potatoes.png",
    milk_2pct_2l: "mehadrin_2pct.jpg",
    milk_1pct_2l: "mehadrin_1pct.jpg",
  };

  let ok = 0;
  let fail = 0;

  for (const item of cfg.items) {
    const destJpg = path.join(OUT_DIR, `${item.id}.jpg`);
    const destPng = path.join(OUT_DIR, `${item.id}.png`);
    const cat = byId.get(item.id);
    const sourceUrl = cat?.offer?.sourceUrl;

    // Keep existing dedicated file
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

    // Alias from older filenames
    const alias = aliases[item.id];
    if (alias) {
      try {
        const src = path.join(OUT_DIR, alias);
        const buf = await readFile(src);
        await writeFile(destJpg, buf);
        item.image = `/products/${item.id}.jpg`;
        console.log(`~ ${item.id} aliased from ${alias}`);
        ok++;
        continue;
      } catch {
        /* no alias file */
      }
    }

    if (!sourceUrl) {
      console.log(`✗ ${item.id} — no sourceUrl (no_match?)`);
      fail++;
      continue;
    }

    console.log(`… ${item.id} fetching PDP`);
    try {
      const imgUrl = await imageFromPdp(sourceUrl);
      if (!imgUrl) {
        console.log(`✗ ${item.id} — no image in PDP`);
        fail++;
        continue;
      }
      const saved = await download(imgUrl, destJpg);
      if (!saved) {
        console.log(`✗ ${item.id} — download failed ${imgUrl.slice(0, 80)}`);
        fail++;
        continue;
      }
      item.image = `/products/${item.id}.jpg`;
      console.log(`✓ ${item.id} ← ${imgUrl.slice(0, 90)}`);
      ok++;
    } catch (e) {
      console.log(
        `✗ ${item.id} — ${e instanceof Error ? e.message.slice(0, 80) : e}`,
      );
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
