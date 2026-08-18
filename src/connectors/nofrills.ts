import {
  ConnectorError,
  type Availability,
  type ProductOffer,
  type RetailerConnector,
} from "./types";
import {
  pcxProductIdsMatch,
  probePcxSearch,
  type PcxProbeResult,
} from "./pcx-bff";

const BANNER = "nofrills" as const;
const ORIGINS = [
  "https://www.nofrills.ca",
  "https://www.realcanadiansuperstore.ca",
];

export type NoFrillsProbeResult = Omit<PcxProbeResult, "banner">;

/** Live PCX BFF search with diagnostics (for manual debugging). */
export async function probeNoFrillsSearch(opts: {
  query: string;
  storeId?: string;
  includeRaw?: boolean;
  rawLimit?: number;
}): Promise<NoFrillsProbeResult> {
  const probed = await probePcxSearch({
    query: opts.query,
    storeId: String(opts.storeId ?? "3660"),
    banner: BANNER,
    retailer: "no_frills",
    origins: ORIGINS,
    includeRaw: opts.includeRaw,
    rawLimit: opts.rawLimit,
  });
  const { banner: _banner, ...rest } = probed;
  return rest;
}

export class NoFrillsConnector implements RetailerConnector {
  readonly id = "no_frills";

  async searchProducts(
    query: string,
    storeId: string,
  ): Promise<ProductOffer[]> {
    if (!storeId) {
      throw new ConnectorError(
        "No Frills requires a storeId for store-specific pricing",
        this.id,
        "no_store_context",
      );
    }

    const probed = await probeNoFrillsSearch({
      query,
      storeId,
      includeRaw: true,
    });
    if (probed.ok) return probed.offers;

    if (probed.error?.startsWith("HTTP ")) {
      throw new ConnectorError(
        `No Frills search ${probed.error}: ${(probed.bodyPreview ?? "").slice(0, 180)}`,
        this.id,
        "http",
      );
    }
    if (probed.error === "non-JSON body") {
      throw new ConnectorError(
        "No Frills returned non-JSON body",
        this.id,
        "parse",
      );
    }

    if (process.env.NOFRILLS_ALLOW_FLIPP_FALLBACK === "1") {
      return this.searchViaFlipp(query, storeId);
    }

    throw new ConnectorError(
      `No Frills blocked or unauthorized (HTTP ${probed.httpStatus ?? "?"}). Empty NOFRILLS_API_KEY is ignored (public web key is used). If this is still 401/403, the edge may be filtering this IP — paste a fresh X-Apikey from a nofrills.ca Network tab into NOFRILLS_API_KEY, or set NOFRILLS_ALLOW_FLIPP_FALLBACK=1 for estimated flyer prices. Body: ${(probed.bodyPreview ?? "").slice(0, 120)}`,
      this.id,
      "blocked",
    );
  }

  /** Flyer-only estimated fallback — not shelf prices. */
  private async searchViaFlipp(
    query: string,
    storeId: string,
  ): Promise<ProductOffer[]> {
    const postal = (process.env.NOFRILLS_POSTAL_CODE ?? "M1P2L8").replace(
      /\s+/g,
      "",
    );
    const url = new URL("https://backflipp.wishabi.com/flipp/items/search");
    url.searchParams.set("locale", "en-ca");
    url.searchParams.set("postal_code", postal);
    url.searchParams.set("q", `No Frills AND ${query}`);

    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (compatible; RoyalSassPOC/0.1; +local-dev)",
      },
    });
    if (!res.ok) {
      throw new ConnectorError(
        `No Frills Flipp fallback HTTP ${res.status}`,
        this.id,
        "http",
      );
    }
    const body = await res.json();
    const items = Array.isArray((body as { items?: unknown }).items)
      ? ((body as { items: Record<string, unknown>[] }).items)
      : [];

    return items
      .map((item) => {
        const name = String(item.name ?? "");
        const price =
          typeof item.current_price === "number"
            ? item.current_price
            : typeof item.price === "number"
              ? item.price
              : Number.parseFloat(
                  String(item.current_price ?? "").replace(/[^0-9.]/g, ""),
                );
        if (!name || !Number.isFinite(price)) return null;
        const offer: ProductOffer = {
          retailer: "no_frills",
          storeId,
          productId: String(item.id ?? `${name}-${price}`),
          name,
          price,
          availability: "unknown",
          confidence: "estimated",
          checkedAt: new Date().toISOString(),
          sourceUrl: "https://www.nofrills.ca/flyer",
          raw: { ...item, _pocNote: "Flipp flyer fallback — not shelf price" },
        };
        return offer;
      })
      .filter((o): o is ProductOffer => o != null);
  }

  async getProduct(
    productId: string,
    storeId: string,
  ): Promise<ProductOffer | null> {
    const hits = await this.searchProducts(productId, storeId);
    const exact = hits.find((h) => pcxProductIdsMatch(h.productId, productId));
    if (exact) return exact;
    if (/^\d{5,}/.test(productId) || /_(EA|KG|LB|C\d+)$/i.test(productId)) {
      return null;
    }
    return hits[0] ?? null;
  }

  async getPrice(
    productId: string,
    storeId: string,
  ): Promise<ProductOffer | null> {
    return this.getProduct(productId, storeId);
  }

  async getAvailability(
    productId: string,
    storeId: string,
  ): Promise<Availability> {
    const offer = await this.getProduct(productId, storeId);
    return offer?.availability ?? "unknown";
  }
}
