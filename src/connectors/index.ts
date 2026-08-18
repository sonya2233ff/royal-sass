import { NoFrillsConnector } from "./nofrills";
import { SobeysConnector } from "./sobeys";
import { WholesaleClubConnector } from "./wholesaleclub";
import { MvrConnector } from "./mvr";
import type { RetailerConnector } from "./types";
import { createWalmartConnector } from "./create-walmart-connector";

export function getConnector(
  retailer: string,
  opts?: { postalCode?: string },
): RetailerConnector {
  switch (retailer) {
    case "no_frills":
      return new NoFrillsConnector();
    case "walmart_ca":
      return createWalmartConnector(opts?.postalCode ?? "L4J0A7");
    case "sobeys":
      return new SobeysConnector(opts?.postalCode ?? "L4J6W7");
    case "wholesale_club":
    case "wholesaleclub":
      return new WholesaleClubConnector();
    case "mvr":
      return new MvrConnector();
    case "freshco":
      throw new Error(
        "FreshCo is not part of the locked 3-store POC. Use retailer 'sobeys'.",
      );
    default:
      throw new Error(`Unknown retailer: ${retailer}`);
  }
}

export * from "./types";
export * from "./store-connector";
export { NoFrillsConnector } from "./nofrills";
export { WalmartConnector } from "./walmart";
export { WalmartRapidConnector, isWalmartRapidConfigured } from "./walmart-rapid";
export { createWalmartConnector } from "./create-walmart-connector";
export {
  resolveWalmartSource,
  walmartSourceApiFields,
  WALMART_RAPID_MISSING_KEY,
} from "./walmart-source";
export { resolveWalmartStorePage } from "./walmart-store";
export {
  SobeysConnector,
  discoverSobeysClarkHilda,
  SOBEYS_CLARK_HILDA_STORE_CODE,
} from "./sobeys";
export { FreshCoConnector, discoverFreshCoEndpoints } from "./freshco";
export {
  WholesaleClubConnector,
  WHOLESALECLUB_STORE_ID,
  WHOLESALECLUB_STORE_KEY,
  probeWholesaleClubSearch,
} from "./wholesaleclub";
export {
  MvrConnector,
  MVR_STORE_ID,
  MVR_STORE_KEY,
  MVR_ORIGIN,
  packageSizeFromMvrTitle,
} from "./mvr";
export { buildFixtureOffers } from "./fixtures";
