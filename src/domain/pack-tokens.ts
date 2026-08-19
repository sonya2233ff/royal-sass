/**
 * Pack size is never product identity. Retailer titles often omit 2.63L / 12oz
 * that the cafe card or settings Include field still mention.
 */

export function stripPackNoise(q: string): string {
  return q
    .replace(
      /\b\d+([.,]\d+)?\s*(l|lt|ml|kg|g|oz|lb|lbs|ct|pk|pack|dozen|doz)\b/gi,
      " ",
    )
    .replace(/\b\d+\s*x\s*\d+\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whole keyword is a size/count ("2.63L", "12oz", "5x1", "2.63"), not a brand. */
export function isPackSizeKeyword(raw: string): boolean {
  const t = raw.trim().toLowerCase().replace(/,/g, ".");
  if (!t) return true;
  if (
    /^\d+([.]\d+)?\s*(l|lt|ml|kg|g|oz|fl\s*oz|lb|lbs|ct|pk|pack|dozen|doz)$/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/^\d+\s*x\s*\d+([.]\d+)?$/i.test(t)) return true;
  if (/^\d+([.]\d+)?$/.test(t)) return true;
  return false;
}

/** Include lists for identity gates — drop litres/ounces so they cannot wipe a match. */
export function identityKeywords(
  list?: readonly string[] | null,
): string[] {
  return (list ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !isPackSizeKeyword(s));
}
