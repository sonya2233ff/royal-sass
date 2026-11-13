/** Road-based transportation cost. Independent of which router produced the distance. */

export type TransportSettingsInput = {
  fuelLitresPer100Km: number;
  fuelPricePerLitre: number;
  driverHourlyCost: number;
  vehicleCostPerKm: number | null;
  useInclusiveVehicleCost: boolean;
  parkingCost: number;
  tollCost: number;
};

export type TransportCostBreakdown = {
  fuelCost: number;
  labourCost: number;
  vehicleCost: number;
  parkingCost: number;
  tollCost: number;
  total: number;
  /** True when the per-km vehicle rate replaced fuel instead of adding to it. */
  fuelSkipped: boolean;
};

export type TransportComparison = {
  proposed: TransportCostBreakdown;
  baseline: TransportCostBreakdown;
  /** Extra cost of the proposed trip beyond the baseline operating trip. */
  incrementalTotal: number;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function computeTransportCost(input: {
  distanceKm: number;
  durationHours: number;
  settings: TransportSettingsInput;
}): TransportCostBreakdown {
  const distanceKm = Math.max(0, input.distanceKm);
  const hours = Math.max(0, input.durationHours);
  const settings = input.settings;
  const inclusive =
    settings.useInclusiveVehicleCost &&
    settings.vehicleCostPerKm != null &&
    settings.vehicleCostPerKm > 0;
  const fuelCost = inclusive
    ? 0
    : round2(
        ((distanceKm * settings.fuelLitresPer100Km) / 100) * settings.fuelPricePerLitre,
      );
  const vehicleCost = inclusive ? round2(distanceKm * (settings.vehicleCostPerKm as number)) : 0;
  const labourCost = round2(hours * settings.driverHourlyCost);
  const parkingCost = round2(Math.max(0, settings.parkingCost));
  const tollCost = round2(Math.max(0, settings.tollCost));
  const total = round2(fuelCost + labourCost + vehicleCost + parkingCost + tollCost);
  return {
    fuelCost,
    labourCost,
    vehicleCost,
    parkingCost,
    tollCost,
    total,
    fuelSkipped: inclusive,
  };
}

/** Proposed trip minus the normal operating trip. Incremental labour is inside that difference. */
export function compareTransportCost(input: {
  proposed: { distanceKm: number; durationHours: number };
  baseline?: { distanceKm: number; durationHours: number };
  settings: TransportSettingsInput;
}): TransportComparison {
  const proposed = computeTransportCost({ ...input.proposed, settings: input.settings });
  const baseline = computeTransportCost({
    distanceKm: input.baseline?.distanceKm ?? 0,
    durationHours: input.baseline?.durationHours ?? 0,
    settings: input.settings,
  });
  return {
    proposed,
    baseline,
    incrementalTotal: round2(Math.max(0, proposed.total - baseline.total)),
  };
}
