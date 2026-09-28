/**
 * Optional OpenAI pass for WhatsApp lines the catalog search left unsure.
 * Returns only Master Product ids from the provided catalog. Never prices.
 */
import type { WhatsAppCatalogItem } from "@/domain/whatsapp-list";

export type WhatsAppAiHint = {
  query: string;
  productId: string | null;
  confidence: number;
};

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

export async function mapWhatsAppLinesWithAi(
  lines: Array<{ query: string; raw: string }>,
  catalog: WhatsAppCatalogItem[],
): Promise<WhatsAppAiHint[]> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key || !lines.length || !catalog.length) return [];
  const allowed = new Set(catalog.map((item) => item.id));
  const products = catalog.map((item) => ({
    id: item.id,
    label: item.label,
  }));
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
      messages: [
        {
          role: "system",
          content:
            "Map messy grocery-list text (English or Ukrainian phonetic) to existing cafe Master Product ids. Return JSON {\"hints\":[{\"query\":\"...\",\"productId\":\"id or null\",\"confidence\":0-1}]}. Use only ids from the provided catalog. If unsure, productId null and low confidence. Never invent products or prices. Shell eggs → large_eggs_dozen. Egg whites ≠ shell eggs. Frozen blueberries ≠ fresh blueberries. Tomato (round) ≠ grape tomatoes.",
        },
        {
          role: "user",
          content: JSON.stringify({ catalog: products, lines }),
        },
      ],
    }),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const parsed = parseJsonObject(data.choices?.[0]?.message?.content ?? "");
  const rows = Array.isArray(parsed?.hints)
    ? parsed!.hints
    : Array.isArray(parsed?.lines)
      ? parsed!.lines
      : [];
  const out: WhatsAppAiHint[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const query = String(rec.query ?? rec.raw ?? "").trim();
    const productIdRaw = rec.productId ?? rec.id ?? rec.matchedId;
    const productId =
      typeof productIdRaw === "string" && allowed.has(productIdRaw.trim())
        ? productIdRaw.trim()
        : null;
    const confidence = Number(rec.confidence);
    out.push({
      query,
      productId,
      confidence:
        Number.isFinite(confidence) && confidence > 0
          ? Math.min(1, confidence)
          : productId
            ? 0.5
            : 0,
    });
  }
  return out;
}
