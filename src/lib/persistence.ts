import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProductOffer } from "@/connectors/types";

const DATA_ROOT = path.join(process.cwd(), "data");

export async function persistRawResponse(input: {
  retailer: string;
  storeId: string;
  requestMeta: unknown;
  body: unknown;
}): Promise<string> {
  const dir = path.join(DATA_ROOT, "raw", input.retailer);
  await mkdir(dir, { recursive: true });
  const id = `${Date.now()}-${input.storeId}-${Math.random().toString(36).slice(2, 8)}`;
  const file = path.join(dir, `${id}.json`);
  await writeFile(
    file,
    JSON.stringify(
      {
        id,
        retailer: input.retailer,
        storeId: input.storeId,
        fetchedAt: new Date().toISOString(),
        requestMeta: input.requestMeta,
        body: input.body,
      },
      null,
      2,
    ),
    "utf8",
  );
  return id;
}

export async function persistObservation(input: {
  storeKey: string;
  itemId: string;
  offer: ProductOffer;
  rawResponseId?: string;
}): Promise<void> {
  const dir = path.join(DATA_ROOT, "observations");
  await mkdir(dir, { recursive: true });
  const file = path.join(
    dir,
    `${input.offer.checkedAt.replace(/[:.]/g, "-")}_${input.storeKey}_${input.itemId}.json`,
  );
  await writeFile(
    file,
    JSON.stringify(
      {
        storeKey: input.storeKey,
        itemId: input.itemId,
        retailer: input.offer.retailer,
        storeId: input.offer.storeId,
        productId: input.offer.productId,
        name: input.offer.name,
        price: input.offer.price,
        promoPrice: input.offer.promoPrice,
        unitPrice: input.offer.unitPrice,
        availability: input.offer.availability,
        confidence: input.offer.confidence,
        checkedAt: input.offer.checkedAt,
        sourceUrl: input.offer.sourceUrl,
        rawResponseId: input.rawResponseId,
      },
      null,
      2,
    ),
    "utf8",
  );
}

export async function persistComparisonRun(result: unknown): Promise<string> {
  const dir = path.join(DATA_ROOT, "runs");
  await mkdir(dir, { recursive: true });
  const id = `run-${Date.now()}`;
  const file = path.join(dir, `${id}.json`);
  await writeFile(file, JSON.stringify(result, null, 2), "utf8");
  return id;
}
