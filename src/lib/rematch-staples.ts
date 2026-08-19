/**
 * Live rematch for selected staples: search again with current product
 * settings (localStorage overrides). Not the same as refresh-prices.
 */
import {
  resolveWalmartSource,
  WALMART_RAPID_MISSING_KEY,
  walmartSourceApiFields,
} from "@/connectors/walmart-source";
import type { ProductOverride } from "@/domain/restaurant-product";
import { refreshMvrSelected } from "@/lib/mvr-observe";
import {
  refreshNoFrillsSelected,
  refreshWalmartSelected,
  type MatchLogEntry,
  type StapleRefreshOpts,
} from "@/lib/staples";
import { refreshWholesaleClubSelected } from "@/lib/wholesaleclub-observe";

const REMATCH: StapleRefreshOpts = { skipIdentityLock: true };

type RetailerResult = {
  updated: string[];
  unmatched?: string[];
  logId?: string;
  entries: Array<{
    itemId: string;
    status: MatchLogEntry["status"];
    accepted?: MatchLogEntry["accepted"] | null;
  }>;
  skipped?: boolean;
  reason?: string;
  error?: string;
};

function slimEntries(entries: MatchLogEntry[]) {
  return entries.map((e) => ({
    itemId: e.itemId,
    status: e.status,
    accepted: e.accepted ?? null,
  }));
}

function failResult(error: string): RetailerResult {
  return { updated: [], entries: [], error };
}

export async function rematchStaples(
  ids: string[],
  overrides: Record<string, ProductOverride>,
): Promise<{
  walmart: RetailerResult;
  noFrills: RetailerResult;
  wholesaleClub: RetailerResult;
  mvr: RetailerResult;
  walmartSource: ReturnType<typeof walmartSourceApiFields>["walmartSource"];
  walmartSkipped: boolean;
  matchLogId: string | null;
}> {
  const source = walmartSourceApiFields();
  const walmartSkipped = resolveWalmartSource() === "missing_key";

  let walmart: RetailerResult;
  if (walmartSkipped) {
    walmart = {
      updated: [],
      entries: [],
      skipped: true,
      reason: WALMART_RAPID_MISSING_KEY,
    };
  } else {
    try {
      const result = await refreshWalmartSelected(ids, overrides, REMATCH);
      walmart = {
        updated: result.updated,
        logId: result.logId,
        entries: slimEntries(result.entries),
      };
    } catch (e) {
      walmart = failResult(e instanceof Error ? e.message : String(e));
    }
  }

  let noFrills: RetailerResult;
  try {
    const result = await refreshNoFrillsSelected(ids, overrides, REMATCH);
    noFrills = {
      updated: result.updated,
      logId: result.logId,
      entries: slimEntries(result.entries),
    };
  } catch (e) {
    noFrills = failResult(e instanceof Error ? e.message : String(e));
  }

  let wholesaleClub: RetailerResult;
  try {
    const result = await refreshWholesaleClubSelected(ids, overrides, REMATCH);
    wholesaleClub = {
      updated: result.updated,
      unmatched: result.unmatched,
      logId: result.logId,
      entries: slimEntries(result.entries),
    };
  } catch (e) {
    wholesaleClub = failResult(e instanceof Error ? e.message : String(e));
  }

  let mvr: RetailerResult;
  try {
    const result = await refreshMvrSelected(ids, overrides, REMATCH);
    mvr = {
      updated: result.updated,
      unmatched: result.unmatched,
      logId: result.logId,
      entries: slimEntries(result.entries),
    };
  } catch (e) {
    mvr = failResult(e instanceof Error ? e.message : String(e));
  }

  const matchLogId =
    walmart.logId ?? noFrills.logId ?? wholesaleClub.logId ?? mvr.logId ?? null;

  return {
    walmart,
    noFrills,
    wholesaleClub,
    mvr,
    walmartSource: source.walmartSource,
    walmartSkipped,
    matchLogId,
  };
}
