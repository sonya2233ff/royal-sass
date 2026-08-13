import { NoFrillsConnector } from "./nofrills";
import { SobeysConnector } from "./sobeys";
import type { RetailerConnector } from "./types";
import { WalmartConnector } from "./walmart";

export function getConnector(
  retailer: string,
  opts?: { postalCode?: string },
): RetailerConnector {
  switch (retailer) {
    case "no_frills":
      return new NoFrillsConnector();
    case "walmart_ca":
      return new WalmartConnector(opts?.postalCode ?? "L4J0A7");
    case "sobeys":
      return new SobeysConnector(opts?.postalCode ?? "L4J6W7");
    case "freshco":
      // Kept for experiments; MVP POC uses Sobeys Clark & Hilda instead.
      throw new Error(
        "FreshCo is not part of the locked 3-store POC. Use retailer 'sobeys'.",
      );
    default:
      throw new Error(`Unknown retailer: ${retailer}`);
  }
}

export * from "./types";
export { NoFrillsConnector } from "./nofrills";
export { WalmartConnector } from "./walmart";
export { resolveWalmartStorePage } from "./walmart-store";
export {
  SobeysConnector,
  discoverSobeysClarkHilda,
  SOBEYS_CLARK_HILDA_STORE_CODE,
} from "./sobeys";
export { FreshCoConnector, discoverFreshCoEndpoints } from "./freshco";
export { buildFixtureOffers } from "./fixtures";
