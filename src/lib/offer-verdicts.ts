import {
  parseOfferVerdictMap,
  type OfferVerdictMap,
} from "@/domain/offer-verdicts";

export const OFFER_VERDICTS_STORAGE_KEY = "royal-sass-offer-verdicts-v1";
export const AUDIT_MODE_STORAGE_KEY = "royal-sass-audit-mode-v1";

export function readOfferVerdicts(): OfferVerdictMap {
  try {
    const raw = window.localStorage.getItem(OFFER_VERDICTS_STORAGE_KEY);
    if (!raw) return {};
    return parseOfferVerdictMap(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

export function writeOfferVerdicts(map: OfferVerdictMap): OfferVerdictMap {
  const next = parseOfferVerdictMap(map);
  try {
    window.localStorage.setItem(
      OFFER_VERDICTS_STORAGE_KEY,
      JSON.stringify(next),
    );
  } catch {
    /* private mode / quota */
  }
  return next;
}

export function readAuditMode(): boolean {
  try {
    return window.localStorage.getItem(AUDIT_MODE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeAuditMode(on: boolean): void {
  try {
    window.localStorage.setItem(AUDIT_MODE_STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}
