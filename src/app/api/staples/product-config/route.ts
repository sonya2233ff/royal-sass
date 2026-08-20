import { NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalizeMatchMode } from "@/domain/restaurant-product";
import { parseOverrideMap, mergeOverrideMaps } from "@/lib/product-config";
import {
  loadRetailerMappings,
  saveRetailerMappings,
} from "@/lib/retailer-mappings";
import { isShownStaple, loadStaplesConfig } from "@/lib/staples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE = path.join(process.cwd(), "data", "catalog", "product-overrides.json");

export async function GET() {
  try {
    const raw = await readFile(FILE, "utf8");
    return NextResponse.json({
      ok: true,
      persisted: true,
      overrides: parseOverrideMap(JSON.parse(raw) as unknown),
    });
  } catch {
    return NextResponse.json({ ok: true, persisted: false, overrides: {} });
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    id?: string;
    override?: unknown;
    overrides?: unknown;
    allOverrides?: unknown;
    previousMatchMode?: string;
  };
  const overrideBlob = body.override ?? body.overrides;
  const fullMap = parseOverrideMap(body.allOverrides);
  const cfg = await loadStaplesConfig();
  if (!body.id || !cfg.items.some((i) => i.id === body.id && isShownStaple(i))) {
    return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
  }
  if (!overrideBlob || typeof overrideBlob !== "object") {
    return NextResponse.json({ ok: false, error: "invalid override" }, { status: 400 });
  }
  const nextMode = canonicalizeMatchMode(
    (overrideBlob as { matchMode?: string } | undefined)?.matchMode,
  );
  const prevMode = canonicalizeMatchMode(body.previousMatchMode);
  if (nextMode && prevMode && nextMode !== prevMode) {
    try {
      const mappings = await loadRetailerMappings();
      const row = mappings.products[body.id];
      if (row) {
        for (const link of Object.values(row.retailers)) {
          if (!link?.retailerProductId) continue;
          link.decision = "needs_review";
          link.verified = false;
          link.updatedAt = new Date().toISOString();
        }
        await saveRetailerMappings(mappings);
      }
    } catch {
      // Vercel read-only — client keeps needs_review via overrides.
    }
  }

  let persisted = false;
  try {
    let current = {} as ReturnType<typeof parseOverrideMap>;
    try {
      current = parseOverrideMap(JSON.parse(await readFile(FILE, "utf8")) as unknown);
    } catch {
      current = {};
    }
    if (Object.keys(fullMap).length) {
      current = mergeOverrideMaps(current, fullMap);
    } else {
      const parsed = parseOverrideMap({ [body.id]: overrideBlob });
      if (parsed[body.id]) current[body.id] = parsed[body.id];
    }
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(current, null, 2) + "\n", "utf8");
    persisted = true;
  } catch {
    persisted = false;
  }
  return NextResponse.json({
    ok: true,
    persisted,
    id: body.id,
    mappingReview: Boolean(nextMode && prevMode && nextMode !== prevMode),
  });
}
