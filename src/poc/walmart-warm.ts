/**
 * One-time (or rare) Walmart CA session warm-up.
 *
 * Opens headed Chromium with a persistent profile under data/walmart-profile.
 * You select store #5831 and pass PerimeterX "Verify" if shown.
 * After that, WalmartConnector uses the same profile — no cookie paste.
 *
 * Usage: npm run walmart:warm
 */
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  closeWalmartBrowser,
  getWalmartBrowserContext,
  walmartBrowserProfileDir,
  warmWalmartSession,
} from "@/connectors/walmart-browser";

const STORE_ID = process.env.WALMART_STORE_ID ?? "5831";

async function main() {
  console.log("Walmart session warm-up");
  console.log(`Store: ${STORE_ID} (700 Centre St, Thornhill)`);
  console.log(`Profile: ${walmartBrowserProfileDir()}`);
  console.log("");
  console.log("A browser window will open.");
  console.log("1) If PerimeterX / Verify appears — complete it.");
  console.log("2) Confirm pickup store is Thornhill #5831.");
  console.log("3) Wait until a search results page loads (milk).");
  console.log("4) Return here and press Enter to save & exit.\n");

  await warmWalmartSession(STORE_ID);

  const rl = readline.createInterface({ input, output });
  const autoSec = Number(process.env.WALMART_WARM_SECONDS ?? "0");
  if (autoSec > 0 && Number.isFinite(autoSec)) {
    console.log(`Auto-continue in ${autoSec}s (WALMART_WARM_SECONDS)…`);
    await new Promise((r) => setTimeout(r, autoSec * 1000));
  } else {
    await rl.question("Press Enter when store is set and page looks normal… ");
  }
  rl.close();

  // Keep context long enough to flush cookies to disk
  const ctx = await getWalmartBrowserContext({ headed: true });
  const cookies = await ctx.cookies("https://www.walmart.ca");
  const px = cookies.some((c) => c.name.startsWith("_px"));
  const catchment = cookies.find((c) => c.name === "deliveryCatchment");
  console.log(
    JSON.stringify(
      {
        cookieCount: cookies.length,
        hasPxCookies: px,
        deliveryCatchment: catchment?.value ?? null,
        profile: walmartBrowserProfileDir(),
      },
      null,
      2,
    ),
  );

  await closeWalmartBrowser();
  console.log("\nDone. Next: npm run poc:receipt  (or poc:walmart-verify)");
}

main().catch(async (e) => {
  console.error(e);
  await closeWalmartBrowser().catch(() => undefined);
  process.exit(1);
});
