/**
 * Shell-egg cartons: quantity is eggs (ea), not "1 pack".
 */
import { parseCountPack } from "@/domain/units";

export const EGG_PACK_IDS = new Set(["grayridge_eggs", "large_eggs_dozen"]);

/** Common cafe cartons, plus the usual MVR 15-dozen / 10×18 case. */
export const EGG_COUNT_PRESETS = [12, 18, 30, 180];

export function isEggPackStaple(item: {
  id?: string;
  category?: string;
}): boolean {
  if (item.id && EGG_PACK_IDS.has(item.id)) return true;
  return item.category === "eggs";
}

export function typicalEggCartonCount(item: { id?: string }): number {
  return item.id === "grayridge_eggs" ? 18 : 12;
}

export function ukEggCountLabel(n: number): string {
  const abs = Math.abs(Math.round(n));
  const n10 = abs % 10;
  const n100 = abs % 100;
  if (n10 === 1 && n100 !== 11) return `${abs} яйце`;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return `${abs} яйця`;
  return `${abs} яєць`;
}

export function eggCountsFromOffer(
  name?: string,
  packageSize?: string,
): number[] {
  const parsed = parseCountPack(name, packageSize);
  if (!parsed) return [];
  const out = [parsed.innerCount];
  if (parsed.totalCount !== parsed.innerCount) out.push(parsed.totalCount);
  return out;
}

export function mergeEggCountChoices(discovered: number[]): {
  choices: number[];
  largestPack: number | null;
} {
  const set = new Set(EGG_COUNT_PRESETS);
  let largest = 0;
  for (const raw of discovered) {
    const n = Math.round(raw);
    if (!Number.isFinite(n) || n < 6 || n > 360) continue;
    set.add(n);
    if (n > largest) largest = n;
  }
  const choices = [...set].sort((a, b) => a - b);
  const fromShelf = largest >= 18 ? largest : 0;
  const fromChoices = choices[choices.length - 1] ?? 0;
  const maxPack = Math.max(fromShelf, fromChoices);
  return {
    choices,
    largestPack: maxPack >= 30 ? maxPack : null,
  };
}

/**
 * Cafe search: Ukrainian "яйця" must find the two shell-egg staples
 * (Grayridge + large dozen), not eggplant / egg whites.
 */
export function queryLooksLikeShellEggs(q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return false;
  if (
    /eggplant|баклажан|egg\s*whites?|яєчн\w*\s*білк|\bбілок\b|\bбілка\b/.test(t)
  ) {
    return false;
  }
  if (/яйц|яєц/.test(t)) return true;
  return /\beggs?\b/.test(t);
}

export function englishEggSearchQueries(q: string): string[] {
  if (!queryLooksLikeShellEggs(q)) return [];
  return ["eggs", "large eggs", "gray ridge eggs", "large eggs dozen"];
}
