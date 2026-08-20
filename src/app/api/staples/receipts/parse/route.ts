import { NextResponse } from "next/server";
import {
  decideReceiptLines,
  parseReceiptText,
  type ReceiptLineDraft,
} from "@/domain/receipt-import";
import { catalogSearchHay } from "@/domain/staple-search";
import { parseCustomStapleDrafts } from "@/lib/product-config";
import { ocrReceiptImages, parseReceiptImages } from "@/lib/receipt-ocr";
import { isShownStaple, loadStaplesConfig } from "@/lib/staples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** OCR/parse receipt photos + pasted text. Does not add cards. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    images?: unknown;
    text?: unknown;
    customStaples?: unknown;
  };
  const images = parseReceiptImages(body.images);
  const pasted = String(body.text ?? "").trim();
  if (!images.length && !pasted) {
    return NextResponse.json(
      { ok: false, error: "photo or pasted receipt text required" },
      { status: 400 },
    );
  }

  const extra = parseCustomStapleDrafts(body.customStaples);
  const cfg = await loadStaplesConfig(extra);
  const catalog = cfg.items.filter(isShownStaple).map((item) => ({
    id: item.id,
    label: item.label,
    queries: item.queries,
    mustIncludeAny: item.mustIncludeAny,
    mustIncludeAll: item.mustIncludeAll,
    searchHay: catalogSearchHay(item),
  }));

  let ocrText = "";
  let ocrSource: string = "none";
  let ocrError: string | undefined;
  let visionLines: ReceiptLineDraft[] | undefined;
  if (images.length) {
    const ocr = await ocrReceiptImages(images);
    ocrText = ocr.text.trim();
    ocrSource = ocr.source;
    ocrError = ocr.error;
    visionLines = ocr.lines;
  }

  const fromVision = visionLines?.length ? visionLines : [];
  const fromOcr = ocrText ? parseReceiptText(ocrText) : [];
  const fromPaste = pasted ? parseReceiptText(pasted) : [];
  const lines =
    fromVision.length || fromOcr.length || fromPaste.length
      ? [...fromVision, ...fromOcr, ...fromPaste].filter(
          (line, i, arr) =>
            arr.findIndex((x) => x.name.toLowerCase() === line.name.toLowerCase()) === i,
        )
      : [];

  if (!lines.length) {
    return NextResponse.json(
      {
        ok: false,
        error:
          ocrError ||
          "could not read products from this receipt — paste the text or try a clearer photo",
        ocrSource,
      },
      { status: 422 },
    );
  }

  const decisions = decideReceiptLines(
    lines,
    catalog,
    cfg.items.map((item) => item.id),
  );

  return NextResponse.json({
    ok: true,
    ocrSource,
    ocrText: ocrText.slice(0, 4000),
    lines,
    decisions,
  });
}
