/**
 * Price provenance — separate from ProductOffer.confidence (exact/estimated/stale).
 * Uber / Instacart are never LIVE_VERIFIED shelf prices.
 */
export type PriceConfidence =
  | "LIVE_VERIFIED"
  | "RECEIPT_VERIFIED"
  | "MULTI_SOURCE_CONFIRMED"
  | "ESTIMATED"
  | "UNKNOWN";

const RECEIPT_TOLERANCE = 0.15;

export function pricesAgree(
  a?: number | null,
  b?: number | null,
  tol = RECEIPT_TOLERANCE,
): boolean {
  if (a == null || b == null) return false;
  if (!(a > 0) || !(b > 0)) return false;
  return Math.abs(a - b) / Math.min(a, b) <= tol;
}

export function assignPriceConfidence(input: {
  hasLiveOffer: boolean;
  offerConfidence?: string | null;
  ageHours?: number | null;
  staleAfterHours?: number;
  hasReceiptPrice: boolean;
  receiptPrice?: number | null;
  livePrice?: number | null;
  hasOtherRetailerLive?: boolean;
  otherLivePrice?: number | null;
  identityLinked?: boolean;
}): PriceConfidence {
  const staleAfter = input.staleAfterHours ?? 72;
  const liveFresh =
    input.hasLiveOffer &&
    (input.offerConfidence === "exact" || input.offerConfidence === "high") &&
    (input.ageHours == null || input.ageHours <= staleAfter);
  const liveStaleOrEstimated =
    input.hasLiveOffer && !liveFresh;

  if (liveFresh && input.hasReceiptPrice && pricesAgree(input.livePrice, input.receiptPrice)) {
    return "MULTI_SOURCE_CONFIRMED";
  }
  if (
    liveFresh &&
    input.identityLinked &&
    pricesAgree(input.livePrice, input.otherLivePrice)
  ) {
    return "MULTI_SOURCE_CONFIRMED";
  }
  if (liveFresh) return "LIVE_VERIFIED";
  if (input.hasReceiptPrice && input.receiptPrice != null && input.receiptPrice > 0) {
    return "RECEIPT_VERIFIED";
  }
  if (liveStaleOrEstimated || input.hasLiveOffer) return "ESTIMATED";
  return "UNKNOWN";
}

/** Delivery apps may confirm ranking/spread only — never shelf. */
export function deliveryValidation(input: {
  shelfPrice?: number | null;
  deliveryPrice?: number | null;
  source?: "instacart" | "uber" | "doordash" | string;
}): {
  usableAsShelf: false;
  source: string;
  spreadPct: number | null;
  rankingHint: "delivery_higher" | "delivery_lower" | "similar" | "incomplete";
} {
  const source = input.source ?? "delivery";
  if (
    input.shelfPrice == null ||
    input.deliveryPrice == null ||
    !(input.shelfPrice > 0) ||
    !(input.deliveryPrice > 0)
  ) {
    return {
      usableAsShelf: false,
      source,
      spreadPct: null,
      rankingHint: "incomplete",
    };
  }
  const spreadPct =
    Math.round(((input.deliveryPrice - input.shelfPrice) / input.shelfPrice) * 1000) /
    10;
  let rankingHint: "delivery_higher" | "delivery_lower" | "similar" = "similar";
  if (spreadPct > 5) rankingHint = "delivery_higher";
  else if (spreadPct < -5) rankingHint = "delivery_lower";
  return { usableAsShelf: false, source, spreadPct, rankingHint };
}
