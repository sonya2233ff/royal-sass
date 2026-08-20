/**
 * Receipt photo OCR. Photos are never written to disk.
 * Order: OpenAI vision → OCR.space → tesseract.js. Pasted text is separate.
 */
import type { ReceiptLineDraft } from "@/domain/receipt-import";

export type ReceiptImage = {
  mime: string;
  dataBase64: string;
};

export type ReceiptOcrResult = {
  text: string;
  source: "openai" | "ocr_space" | "tesseract" | "none";
  lines?: ReceiptLineDraft[];
  error?: string;
};

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MAX_IMAGES = 4;
const MAX_BASE64_CHARS = 1_800_000;

export function parseReceiptImages(raw: unknown): ReceiptImage[] {
  if (!Array.isArray(raw)) return [];
  const out: ReceiptImage[] = [];
  for (const row of raw.slice(0, MAX_IMAGES)) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const mime = String(r.mime ?? "")
      .toLowerCase()
      .split(";")[0]!
      .trim();
    const dataBase64 = String(r.dataBase64 ?? "").replace(/\s+/g, "");
    if (!ALLOWED_MIME.has(mime) || !dataBase64) continue;
    if (dataBase64.length > MAX_BASE64_CHARS) continue;
    out.push({ mime: mime === "image/jpg" ? "image/jpeg" : mime, dataBase64 });
  }
  return out;
}

function dataUrl(image: ReceiptImage): string {
  return `data:${image.mime};base64,${image.dataBase64}`;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1]!.trim() : trimmed;
  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function linesFromUnknown(raw: unknown): ReceiptLineDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: ReceiptLineDraft[] = [];
  for (const row of raw) {
    if (typeof row === "string") {
      const name = row.replace(/\s+/g, " ").trim();
      if (name.length >= 3) out.push({ name });
      continue;
    }
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const name = String(r.name ?? r.item ?? r.description ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (name.length < 3) continue;
    const price = Number(r.price ?? r.amount);
    const qty = Number(r.qty ?? r.quantity);
    out.push({
      name,
      price: Number.isFinite(price) && price > 0 ? price : undefined,
      qty: Number.isFinite(qty) && qty > 0 ? qty : undefined,
    });
  }
  return out;
}

async function ocrOpenAi(images: ReceiptImage[]): Promise<ReceiptOcrResult | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text:
        "Read this grocery receipt. Return JSON only: " +
        '{"text":"full OCR text","lines":[{"name":"product name","qty":1,"price":1.23}]}. ' +
        "Skip tax, HST, GST, totals, payments, bag fees, barcodes, store header. " +
        "Keep sold product names as printed.",
    },
  ];
  for (const image of images) {
    content.push({
      type: "image_url",
      image_url: { url: dataUrl(image), detail: "high" },
    });
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_RECEIPT_MODEL?.trim() || "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    return {
      text: "",
      source: "none",
      error: `OpenAI ${res.status} ${err.slice(0, 160)}`,
    };
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const contentText = data.choices?.[0]?.message?.content ?? "";
  const parsed = parseJsonObject(contentText);
  const lines = linesFromUnknown(parsed?.lines ?? parsed?.items);
  const text =
    String(parsed?.text ?? "").trim() ||
    lines.map((l) => `${l.name}${l.price != null ? ` ${l.price.toFixed(2)}` : ""}`).join("\n");
  return { text, source: "openai", lines: lines.length ? lines : undefined };
}

async function ocrSpace(images: ReceiptImage[]): Promise<ReceiptOcrResult | null> {
  const key = process.env.OCR_SPACE_API_KEY?.trim();
  if (!key) return null;
  const parts: string[] = [];
  for (const image of images) {
    const body = new URLSearchParams();
    body.set("apikey", key);
    body.set("base64Image", dataUrl(image));
    body.set("language", "eng");
    body.set("OCREngine", "2");
    body.set("isOverlayRequired", "false");
    body.set("scale", "true");
    const res = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      return {
        text: "",
        source: "none",
        error: `OCR.space ${res.status}`,
      };
    }
    const data = (await res.json()) as {
      IsErroredOnProcessing?: boolean;
      ErrorMessage?: string | string[];
      ParsedResults?: Array<{ ParsedText?: string }>;
    };
    if (data.IsErroredOnProcessing) {
      const msg = Array.isArray(data.ErrorMessage)
        ? data.ErrorMessage.join("; ")
        : String(data.ErrorMessage ?? "ocr error");
      return { text: "", source: "none", error: msg.slice(0, 160) };
    }
    const text = (data.ParsedResults ?? [])
      .map((row) => row.ParsedText ?? "")
      .join("\n")
      .trim();
    if (text) parts.push(text);
  }
  return { text: parts.join("\n"), source: "ocr_space" };
}

async function ocrTesseract(images: ReceiptImage[]): Promise<ReceiptOcrResult | null> {
  try {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng", 1, {
      cachePath: "/tmp/tesseract-cache",
    });
    try {
      const parts: string[] = [];
      for (const image of images) {
        const buf = Buffer.from(image.dataBase64, "base64");
        const { data } = await worker.recognize(buf);
        if (data.text?.trim()) parts.push(data.text.trim());
      }
      return { text: parts.join("\n"), source: "tesseract" };
    } finally {
      await worker.terminate();
    }
  } catch (e) {
    return {
      text: "",
      source: "none",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function ocrReceiptImages(
  images: ReceiptImage[],
): Promise<ReceiptOcrResult> {
  if (!images.length) return { text: "", source: "none" };
  const openai = await ocrOpenAi(images).catch(
    (e): ReceiptOcrResult => ({
      text: "",
      source: "none",
      error: e instanceof Error ? e.message : String(e),
    }),
  );
  if (openai && (openai.text.trim() || openai.lines?.length)) return openai;

  const space = await ocrSpace(images).catch(
    (e): ReceiptOcrResult => ({
      text: "",
      source: "none",
      error: e instanceof Error ? e.message : String(e),
    }),
  );
  if (space && space.text.trim()) return space;

  const tess = await ocrTesseract(images);
  if (tess && tess.text.trim()) return tess;

  const error =
    openai?.error || space?.error || tess?.error || "could not read receipt photo";
  return { text: "", source: "none", error };
}
