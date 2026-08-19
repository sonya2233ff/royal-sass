/**
 * Amount units for restaurant purchase config.
 * Never convert mass ↔ volume.
 */
export type AmountUnit = "g" | "kg" | "ml" | "l" | "ea" | "pack";
export type BaseUnit = "g" | "ml" | "ea";
export type Dimension = "mass" | "volume" | "count";

export const DEFAULT_TOLERANCE_PERCENT = 15;

export function dimensionOf(unit: AmountUnit): Dimension {
  if (unit === "g" || unit === "kg") return "mass";
  if (unit === "ml" || unit === "l") return "volume";
  return "count";
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function toBase(
  amount: number,
  unit: AmountUnit,
): { amount: number; unit: BaseUnit } {
  if (unit === "kg") return { amount: amount * 1000, unit: "g" };
  if (unit === "g") return { amount, unit: "g" };
  if (unit === "l") return { amount: amount * 1000, unit: "ml" };
  if (unit === "ml") return { amount, unit: "ml" };
  return { amount, unit: "ea" };
}

export function fromBase(amount: number, unit: AmountUnit): number {
  if (unit === "kg") return amount / 1000;
  if (unit === "l") return amount / 1000;
  return amount;
}

export function sameDimension(a: AmountUnit, b: AmountUnit): boolean {
  return dimensionOf(a) === dimensionOf(b);
}

/** Convert amount from → to only when both are mass, both volume, or both count. */
export function convertAmount(
  amount: number,
  from: AmountUnit,
  to: AmountUnit,
): number | null {
  if (!Number.isFinite(amount)) return null;
  if (!sameDimension(from, to)) return null;
  const base = toBase(amount, from);
  const one = toBase(1, to);
  if (!(one.amount > 0)) return null;
  return base.amount / one.amount;
}

const MASS_ONLY_RE =
  /(\d+(?:\.\d+)?)\s*(kg|lb|lbs|oz|ounce|ounces|gr|g)\b/gi;
const VOLUME_ONLY_RE = /(\d+(?:\.\d+)?)\s*(ml|lt|l)\b/gi;
const NX_MASS_RE =
  /(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(kg|lb|lbs|oz|gr|g)\b/i;
const NX_VOL_RE = /(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*(ml|lt|l)\b/i;

const KG_PER_LB = 0.45359237;

function massToKg(value: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u === "kg") return value;
  if (u === "g" || u === "gr") return value / 1000;
  if (u === "lb" || u === "lbs") return value * KG_PER_LB;
  if (u === "oz" || u === "ounce" || u === "ounces") return (value / 16) * KG_PER_LB;
  return 0;
}

function volumeToMl(value: number, unit: string): number {
  const u = unit.toLowerCase();
  if (u === "l" || u === "lt") return value * 1000;
  if (u === "ml") return value;
  return 0;
}

export function parseMassKg(text: string): number | null {
  const s = text.toLowerCase().replace(/,/g, "");
  const nx = s.match(NX_MASS_RE);
  if (nx) {
    const kg = Number(nx[1]) * massToKg(Number(nx[2]), nx[3]);
    return kg > 0 ? kg : null;
  }
  let best = 0;
  for (const m of s.matchAll(MASS_ONLY_RE)) {
    const i = m.index ?? 0;
    if (s[i - 1] === "/" || s[i - 1] === "$") continue;
    const kg = massToKg(Number(m[1]), m[2]);
    if (kg > best) best = kg;
  }
  return best > 0 ? best : null;
}

export function parseVolumeMl(text: string): number | null {
  const s = text.toLowerCase().replace(/,/g, "");
  const nx = s.match(NX_VOL_RE);
  if (nx) {
    const ml = Number(nx[1]) * volumeToMl(Number(nx[2]), nx[3]);
    return ml > 0 ? ml : null;
  }
  let best = 0;
  for (const m of s.matchAll(VOLUME_ONLY_RE)) {
    const i = m.index ?? 0;
    if (s[i - 1] === "/" || s[i - 1] === "$") continue;
    const ml = volumeToMl(Number(m[1]), m[2]);
    if (ml > best) best = ml;
  }
  return best > 0 ? mlBest(best) : null;
}

function mlBest(n: number): number {
  return n;
}

export function offerText(name?: string, packageSize?: string): string {
  return `${name ?? ""} ${packageSize ?? ""}`.trim();
}
