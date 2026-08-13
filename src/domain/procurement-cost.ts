/**
 * Future-ready procurement cost model.
 * MVP: only product cost; labor/driving/stop costs stay zero until routing is built.
 */
export interface ProcurementCostInputs {
  /** Employee hourly wage CAD — future */
  employeeHourlyWage?: number;
  /** Estimated travel time in hours across the trip — future */
  travelTimeHours?: number;
  /** Fixed vehicle / fuel cost for the trip — future */
  vehicleCost?: number;
  /** Extra cost charged per additional stop beyond the first — future */
  additionalStopCost?: number;
  /** Minimum savings required to justify another stop — future policy hook */
  minSavingsForExtraStop?: number;
}

export interface ProcurementCostBreakdown {
  productCost: number;
  employeeTimeCost: number;
  drivingCost: number;
  additionalStopCost: number;
  realCost: number;
}

export function calculateProcurementCost(
  productCost: number,
  stopCount: number,
  inputs: ProcurementCostInputs = {},
): ProcurementCostBreakdown {
  const employeeTimeCost =
    (inputs.employeeHourlyWage ?? 0) * (inputs.travelTimeHours ?? 0);
  const drivingCost = inputs.vehicleCost ?? 0;
  const extraStops = Math.max(0, stopCount - 1);
  const additionalStopCost =
    extraStops * (inputs.additionalStopCost ?? 0);

  const realCost =
    Math.round(
      (productCost + employeeTimeCost + drivingCost + additionalStopCost) * 100,
    ) / 100;

  return {
    productCost: Math.round(productCost * 100) / 100,
    employeeTimeCost: Math.round(employeeTimeCost * 100) / 100,
    drivingCost: Math.round(drivingCost * 100) / 100,
    additionalStopCost: Math.round(additionalStopCost * 100) / 100,
    realCost,
  };
}
