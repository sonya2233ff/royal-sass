/**
 * Basket coverage: missing items are N/A, never $0.
 */
import { roundMoney } from "@/domain/purchase-units";

export interface StoreCoverage {
  requestedItems: number;
  availableComparableItems: number;
  checkoutTotal: number | null;
  complete: boolean;
  coverage: string;
}

export function storeCoverage(
  checkoutCosts: Array<number | null | undefined>,
): StoreCoverage {
  const requestedItems = checkoutCosts.length;
  const available = checkoutCosts.filter(
    (n): n is number => n != null && Number.isFinite(n),
  );
  const complete = requestedItems > 0 && available.length === requestedItems;
  return {
    requestedItems,
    availableComparableItems: available.length,
    checkoutTotal: complete
      ? roundMoney(available.reduce((s, n) => s + n, 0))
      : null,
    complete,
    coverage: `${available.length} із ${requestedItems} товарів`,
  };
}

export function completeBasketWinner(
  stores: Array<{ id: string; coverage: StoreCoverage }>,
): string {
  const complete = stores.filter(
    (s) => s.coverage.complete && s.coverage.checkoutTotal != null,
  );
  if (complete.length === 0) return "incomplete";
  if (complete.length === 1) return complete[0]!.id;
  const min = Math.min(...complete.map((s) => s.coverage.checkoutTotal!));
  const winners = complete.filter(
    (s) => Math.abs(s.coverage.checkoutTotal! - min) < 0.005,
  );
  return winners.length === 1 ? winners[0]!.id : "tie";
}
