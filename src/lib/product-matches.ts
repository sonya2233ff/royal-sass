/**
 * JSON store for cross-retailer product matches.
 * Live staples compare does not read this yet. Prisma ProductMatch is the
 * target schema when the app starts using SQLite for identity.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  EntityMatchResult,
  MatchDecision,
  MatchMethod,
  ProductRecord,
} from "@/domain/entity-match";

const FILE = path.join(process.cwd(), "data", "catalog", "product-matches.json");

export interface StoredProductMatch {
  id: string;
  leftRetailer: string;
  leftProductId: string;
  rightRetailer: string;
  rightProductId: string;
  matchMethod: MatchMethod;
  matchConfidence: number;
  verified: boolean;
  verifiedAt?: string;
  decision: MatchDecision;
  explain: EntityMatchResult["explain"];
  updatedAt: string;
}

export interface ProductMatchStore {
  updatedAt: string;
  autoLinkThreshold: number;
  matches: StoredProductMatch[];
}

function emptyStore(threshold: number): ProductMatchStore {
  return {
    updatedAt: new Date().toISOString(),
    autoLinkThreshold: threshold,
    matches: [],
  };
}

function canonicalPair(
  a: ProductRecord,
  b: ProductRecord,
): {
  leftRetailer: string;
  leftProductId: string;
  rightRetailer: string;
  rightProductId: string;
} {
  const leftId = a.retailerProductId ?? a.upc ?? normalizeNameKey(a.name);
  const rightId = b.retailerProductId ?? b.upc ?? normalizeNameKey(b.name);
  const leftKey = `${a.retailer}::${leftId}`;
  const rightKey = `${b.retailer}::${rightId}`;
  if (leftKey <= rightKey) {
    return {
      leftRetailer: a.retailer,
      leftProductId: leftId,
      rightRetailer: b.retailer,
      rightProductId: rightId,
    };
  }
  return {
    leftRetailer: b.retailer,
    leftProductId: rightId,
    rightRetailer: a.retailer,
    rightProductId: leftId,
  };
}

function normalizeNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 80);
}

function pairKey(m: {
  leftRetailer: string;
  leftProductId: string;
  rightRetailer: string;
  rightProductId: string;
}): string {
  return `${m.leftRetailer}::${m.leftProductId}||${m.rightRetailer}::${m.rightProductId}`;
}

export async function loadProductMatches(): Promise<ProductMatchStore> {
  try {
    const raw = await readFile(FILE, "utf8");
    return JSON.parse(raw) as ProductMatchStore;
  } catch {
    return emptyStore(0.85);
  }
}

export async function upsertProductMatch(input: {
  left: ProductRecord;
  right: ProductRecord;
  result: EntityMatchResult;
  threshold: number;
}): Promise<StoredProductMatch> {
  const store = await loadProductMatches();
  const pair = canonicalPair(input.left, input.right);
  const id = pairKey(pair);
  const record: StoredProductMatch = {
    id,
    ...pair,
    matchMethod: input.result.matchMethod,
    matchConfidence: input.result.matchConfidence,
    verified: input.result.verified,
    verifiedAt: input.result.verified ? new Date().toISOString() : undefined,
    decision: input.result.decision,
    explain: input.result.explain,
    updatedAt: new Date().toISOString(),
  };
  const idx = store.matches.findIndex((m) => m.id === id);
  if (idx >= 0) store.matches[idx] = record;
  else store.matches.push(record);
  store.updatedAt = record.updatedAt;
  store.autoLinkThreshold = input.threshold;
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(store, null, 2), "utf8");
  return record;
}

export async function verifyProductMatch(
  id: string,
  verified: boolean,
): Promise<StoredProductMatch | null> {
  const store = await loadProductMatches();
  const rec = store.matches.find((m) => m.id === id);
  if (!rec) return null;
  rec.verified = verified;
  rec.verifiedAt = verified ? new Date().toISOString() : undefined;
  if (verified) rec.decision = "auto_linked";
  rec.updatedAt = new Date().toISOString();
  store.updatedAt = rec.updatedAt;
  await writeFile(FILE, JSON.stringify(store, null, 2), "utf8");
  return rec;
}
