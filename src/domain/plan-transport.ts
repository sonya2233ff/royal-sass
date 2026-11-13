import { compareTransportCost, type TransportSettingsInput } from "@/domain/transport-cost";

export type PlanTransportInput = {
  id: string;
  productTotal: number;
  distanceKm: number;
  durationHours: number;
};

/**
 * Rank purchasing plans by product cost plus the extra road cost of that plan.
 * Does not change shelf-price compare. Baseline is the normal operating trip.
 */
export function rankPlansByIncrementalTransport(input: {
  plans: PlanTransportInput[];
  baseline: { distanceKm: number; durationHours: number };
  settings: TransportSettingsInput;
}): Array<PlanTransportInput & { incrementalTransport: number; comparedTotal: number }> {
  return input.plans
    .map((plan) => {
      const compared = compareTransportCost({
        proposed: { distanceKm: plan.distanceKm, durationHours: plan.durationHours },
        baseline: input.baseline,
        settings: input.settings,
      });
      return {
        ...plan,
        incrementalTransport: compared.incrementalTotal,
        comparedTotal: Math.round((plan.productTotal + compared.incrementalTotal) * 100) / 100,
      };
    })
    .sort((a, b) => a.comparedTotal - b.comparedTotal || a.productTotal - b.productTotal);
}
