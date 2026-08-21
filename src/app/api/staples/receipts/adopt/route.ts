import { NextResponse } from "next/server";
import { catalogSearchHay } from "@/domain/staple-search";
import type { ReceiptStapleDraft } from "@/domain/receipt-import";
import { parseCustomStapleDrafts } from "@/lib/product-config";
import {
  isShownStaple,
  loadStaplesConfig,
  saveCustomStaplesMerge,
  unremoveStapleIds,
  type StapleItem,
} from "@/lib/staples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function draftToStaple(draft: ReceiptStapleDraft): StapleItem | null {
  if (draft.custom !== true) return null;
  if (!draft.id.startsWith("receipt_") && !draft.id.startsWith("custom_")) {
    return null;
  }
  const label = draft.label.replace(/\s+/g, " ").trim().slice(0, 80);
  if (label.length < 3) return null;
  return {
    id: draft.id,
    label,
    queries: draft.queries?.length ? draft.queries : [label],
    mustIncludeAny: draft.mustIncludeAny,
    mustIncludeAll: draft.mustIncludeAll,
    mustNotInclude: draft.mustNotInclude,
    matchMode: draft.matchMode,
    category: draft.category,
    unit: draft.unit,
    notes: draft.notes || (draft.id.startsWith("custom_")
      ? "Added from homepage"
      : "Added from receipt photo"),
    custom: true,
  };
}

/** Confirm new receipt / homepage drafts into custom staples. No store prices guessed. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    drafts?: unknown;
    customStaples?: unknown;
  };
  const parsed = parseCustomStapleDrafts(body.drafts);
  const fromDrafts = Array.isArray(body.drafts)
    ? (body.drafts as ReceiptStapleDraft[])
        .map((row) => (row && typeof row === "object" ? draftToStaple(row) : null))
        .filter((row): row is StapleItem => Boolean(row))
    : [];
  const wanted = fromDrafts.length ? fromDrafts : (parsed as StapleItem[]);
  if (!wanted.length) {
    return NextResponse.json(
      { ok: false, error: "drafts required" },
      { status: 400 },
    );
  }

  const extra = parseCustomStapleDrafts(body.customStaples);
  const cfg = await loadStaplesConfig(extra);
  const occupied = new Set(cfg.items.map((item) => item.id));
  const shown = new Set(cfg.items.filter(isShownStaple).map((item) => item.id));

  const items: StapleItem[] = [];
  for (const item of wanted) {
    if (shown.has(item.id)) continue;
    let id = item.id;
    let n = 2;
    while (occupied.has(id)) {
      id = `${item.id}_${n}`;
      n += 1;
    }
    occupied.add(id);
    items.push({ ...item, id, custom: true });
  }

  if (!items.length) {
    return NextResponse.json({
      ok: true,
      persisted: true,
      added: [],
      items: [],
    });
  }

  const persisted = await saveCustomStaplesMerge(items);
  await unremoveStapleIds(items.map((item) => item.id));

  return NextResponse.json({
    ok: true,
    persisted,
    added: items.map((item) => item.id),
    items: items.map((item) => ({
      ...item,
      searchHay: catalogSearchHay(item),
    })),
  });
}
