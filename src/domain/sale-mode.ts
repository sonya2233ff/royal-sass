/**
 * How a store sells an offer. Do not treat $/kg as proof of loose weight.
 */
export type SaleMode = "loose_weight" | "fixed_pack" | "case";

const CASE_RE =
  /\b(case|cases|box|boxes|repack|crate|carton\s+case|15\s*lb\s*case)\b/i;
const MULTI_PACK_RE = /\b\d+\s*x\s*\d+/i;
const FIXED_RE =
  /\b(pack|packs|bag|bags|box|clamshell|carton|tub|jar|bottle|pouch|sleeve|tray|case)\b/i;
const LOOSE_RE =
  /\b(per\s*kg|per\s*lb|\/\s*kg|\/\s*lb|loose|bulk|sold\s*by\s*(the\s*)?(kg|lb|weight))\b/i;

export function inferSaleMode(input: {
  name: string;
  packageSize?: string;
  /** Staple is typically weighed at the scale — still overridden by pack/case words. */
  stapleSoldByWeight?: boolean;
}): SaleMode {
  const t = `${input.name} ${input.packageSize ?? ""}`;
  if (CASE_RE.test(t) || MULTI_PACK_RE.test(t) || /\b\d+\s*lb\s*case\b/i.test(t)) {
    return "case";
  }
  if (FIXED_RE.test(t) && !LOOSE_RE.test(t)) {
    return "fixed_pack";
  }
  if (LOOSE_RE.test(t)) return "loose_weight";
  if (input.stapleSoldByWeight && !FIXED_RE.test(t)) return "loose_weight";
  return "fixed_pack";
}
