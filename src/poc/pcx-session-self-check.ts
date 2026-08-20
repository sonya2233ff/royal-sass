/**
 * Fixture self-check for PCX cookie/session helpers (no network).
 *   npm run poc:pcx-session
 */
import {
  applySetCookieHeader,
  cookieHeaderFromJar,
  formatPcxFulfillmentDate,
  parseCookieHeader,
  parseSetCookieLine,
} from "@/connectors/pcx-session";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  parseSetCookieLine("bm_sz=abc; Path=/; Secure; HttpOnly")?.name === "bm_sz",
  "parse name",
);
assert(
  parseSetCookieLine("bm_sz=abc; Path=/; Secure; HttpOnly")?.value === "abc",
  "parse value",
);
assert(parseSetCookieLine("Path=/") == null, "skip attribute-only");

const jar = new Map<string, string>();
applySetCookieHeader(jar, "_abck=sensor; Domain=.nofrills.ca; Path=/");
applySetCookieHeader(jar, "bm_sz=tok; Max-Age=3600");
assert(cookieHeaderFromJar(jar) === "_abck=sensor; bm_sz=tok", "join");
applySetCookieHeader(jar, "_abck=deleted; Max-Age=0");
assert(cookieHeaderFromJar(jar) === "bm_sz=tok", "delete stale cookie");

const fromHeader = parseCookieHeader("a=1; b=two; Path=/; c=3");
assert(fromHeader.get("a") === "1" && fromHeader.get("c") === "3", "env cookie header");
assert(!fromHeader.has("Path"), "do not treat Path as a cookie");

assert(
  formatPcxFulfillmentDate(new Date("2026-08-19T04:30:00Z")) === "19082026",
  "Toronto date after midnight EDT",
);
assert(
  formatPcxFulfillmentDate(new Date("2026-08-19T03:30:00Z")) === "18082026",
  "Toronto date before midnight EDT",
);
assert(
  formatPcxFulfillmentDate(new Date("2026-01-19T05:30:00Z")) === "19012026",
  "Toronto date after midnight EST",
);

console.log("pcx-session-self-check ok");
