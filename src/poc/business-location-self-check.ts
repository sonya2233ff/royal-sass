/**
 * Business location, tenant isolation, transport cost, and route snapshots.
 * Google is stubbed. No live Places or Routes calls.
 */
import { rankPlansByIncrementalTransport } from "../domain/plan-transport";
import { compareTransportCost, computeTransportCost } from "../domain/transport-cost";
import { prisma } from "../lib/prisma";
import { googleContentFresh, parseAddressComponents, autocompletePlaces, GOOGLE_CONTENT_TTL_MS } from "../lib/google-places";
import { computeRoute, parseDurationSeconds, routeStops } from "../lib/google-routes";
import {
  addBusinessLocation,
  createBusinessWorkspace,
  estimateBusinessRoute,
  updateBusinessLocation,
  validateLocationInput,
  type LocationInput,
} from "../lib/business-location";
import { beginSignup, confirmSignupCode } from "../lib/signup-verification";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const settings = {
  fuelLitresPer100Km: 8,
  fuelPricePerLitre: 2,
  driverHourlyCost: 20,
  vehicleCostPerKm: 0.5,
  useInclusiveVehicleCost: false,
  parkingCost: 0,
  tollCost: 0,
};

const cafe: LocationInput = {
  locationName: "Check Cafe",
  formattedAddress: "10 Example St, Thornhill, ON L4J 0A1, Canada",
  streetAddress: "10 Example St",
  city: "Thornhill",
  province: "ON",
  postalCode: "L4J 0A1",
  country: "Canada",
  latitude: 43.81,
  longitude: -79.45,
  googlePlaceId: null,
  source: "manual",
};

const branch: LocationInput = {
  ...cafe,
  locationName: "Check Cafe West",
  streetAddress: "20 Example St",
  formattedAddress: "20 Example St, Vaughan, ON L4J 0A2, Canada",
  city: "Vaughan",
  postalCode: "L4J 0A2",
  latitude: 43.82,
  longitude: -79.46,
};

async function main() {
  const fuel = computeTransportCost({ distanceKm: 10, durationHours: 1, settings });
  assert(fuel.fuelCost === 1.6, `fuel ${fuel.fuelCost}`);
  assert(fuel.labourCost === 20, `labour ${fuel.labourCost}`);
  assert(fuel.total === 21.6, `total ${fuel.total}`);
  assert(fuel.fuelSkipped === false, "fuel should be counted");

  const inclusive = computeTransportCost({
    distanceKm: 10,
    durationHours: 1,
    settings: { ...settings, useInclusiveVehicleCost: true },
  });
  assert(inclusive.fuelCost === 0, "inclusive rate must not also add fuel");
  assert(inclusive.vehicleCost === 5, `vehicle ${inclusive.vehicleCost}`);
  assert(inclusive.fuelSkipped === true, "fuel skipped");

  const compared = compareTransportCost({
    proposed: { distanceKm: 10, durationHours: 1 },
    baseline: { distanceKm: 5, durationHours: 0.5 },
    settings,
  });
  assert(compared.incrementalTotal === 10.8, `incremental ${compared.incrementalTotal}`);

  const ranked = rankPlansByIncrementalTransport({
    plans: [
      { id: "far", productTotal: 10, distanceKm: 30, durationHours: 1 },
      { id: "near", productTotal: 12, distanceKm: 6, durationHours: 0.4 },
    ],
    baseline: { distanceKm: 5, durationHours: 0.5 },
    settings,
  });
  assert(ranked[0]?.id === "near", `rank ${ranked.map((plan) => plan.id).join(",")}`);
  assert(ranked[0].comparedTotal < ranked[1].comparedTotal, "near plan should win once road cost is included");

  const loop = routeStops({
    origin: { latitude: 1, longitude: 2, label: "cafe" },
    stops: [
      { latitude: 3, longitude: 4, label: "a" },
      { latitude: 5, longitude: 6, label: "b" },
    ],
    returnToOrigin: true,
    optimize: true,
  });
  assert(loop?.intermediates?.length === 2, "loop keeps both suppliers as stops");
  assert(loop?.destination.latitude === 1, "loop returns to the business");
  const delivery = routeStops({
    origin: { latitude: 1, longitude: 2 },
    stops: [{ latitude: 9, longitude: 9, label: "drop" }],
    returnToOrigin: false,
  });
  assert(delivery?.destination.latitude === 9 && (delivery.intermediates?.length ?? 0) === 0, "delivery ends at the stop");
  assert(parseDurationSeconds("900s") === 900, "duration");
  assert(parseDurationSeconds("nope") === null, "bad duration");

  const parsed = parseAddressComponents(
    [
      { longText: "10", types: ["street_number"] },
      { longText: "Example St", types: ["route"] },
      { longText: "Thornhill", types: ["locality"] },
      { shortText: "ON", types: ["administrative_area_level_1"] },
      { longText: "L4J 0A1", types: ["postal_code"] },
      { shortText: "CA", types: ["country"] },
    ],
    "10 Example St, Thornhill, ON L4J 0A1, Canada",
    "Check Cafe",
  );
  assert(parsed.streetAddress === "10 Example St", parsed.streetAddress);
  assert(parsed.city === "Thornhill" && parsed.province === "ON" && parsed.country === "CA", "components");
  assert(validateLocationInput({ ...cafe, streetAddress: "" }) === "Вкажи вулицю і номер.", "incomplete street");
  assert(validateLocationInput({ ...cafe, postalCode: "123" })?.includes("A1A"), "postal");
  assert(googleContentFresh(new Date()) === true, "fresh");
  assert(googleContentFresh(new Date(Date.now() - GOOGLE_CONTENT_TTL_MS - 1000)) === false, "stale");

  const savedKey = process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.GOOGLE_MAPS_API_KEY;
  const missing = await autocompletePlaces("cafe thornhill", "11111111-1111-4111-8111-111111111111");
  assert(missing.ok === false && missing.code === "not_configured", "autocomplete without a key");
  const noRoute = await computeRoute({
    origin: { latitude: 1, longitude: 2 },
    destination: { latitude: 3, longitude: 4 },
  });
  assert(noRoute.ok === false && noRoute.code === "not_configured", "routes without a key");

  process.env.GOOGLE_MAPS_API_KEY = "test-only";
  const before = await prisma.businessLocation.count();
  const found = await autocompletePlaces("cafe thornhill", "11111111-1111-4111-8111-111111111111", async () =>
    new Response(
      JSON.stringify({
        suggestions: [
          {
            placePrediction: {
              placeId: "ChIJtestplace",
              structuredFormat: { mainText: { text: "Listed Cafe" }, secondaryText: { text: "1 Road, Toronto" } },
            },
          },
        ],
      }),
      { status: 200 },
    ),
  );
  assert(found.ok && found.data[0]?.name === "Listed Cafe", "suggestion name");
  assert((await prisma.businessLocation.count()) === before, "autocomplete must not store listings");
  const empty = await autocompletePlaces("zzz", "11111111-1111-4111-8111-111111111111", async () =>
    new Response(JSON.stringify({ suggestions: [] }), { status: 200 }),
  );
  assert(empty.ok && empty.data.length === 0, "empty suggestions");
  const quota = await computeRoute(
    { origin: { latitude: 1, longitude: 2 }, destination: { latitude: 3, longitude: 4 } },
    async () => new Response("RESOURCE_EXHAUSTED", { status: 403 }),
  );
  assert(quota.ok === false && quota.code === "quota", "quota");
  const absent = await computeRoute(
    { origin: { latitude: 1, longitude: 2 }, destination: { latitude: 3, longitude: 4 } },
    async () => new Response(JSON.stringify({ routes: [] }), { status: 200 }),
  );
  assert(absent.ok === false && absent.code === "not_found", "no route");
  if (savedKey) process.env.GOOGLE_MAPS_API_KEY = savedKey;
  else delete process.env.GOOGLE_MAPS_API_KEY;

  const stamp = Date.now();
  const ownerA = await prisma.customer.create({
    data: { name: "Owner A", email: `loc-a-${stamp}@cafe.test`, passwordHash: "scrypt:test:00" },
  });
  const signupEmail = `signup-place-${stamp}@cafe.test`;
  let signupCustomerId: string | null = null;

  const ownerB = await prisma.customer.create({
    data: { name: "Owner B", email: `loc-b-${stamp}@cafe.test`, passwordHash: "scrypt:test:00" },
  });
  const driver = await prisma.customer.create({
    data: { name: "Driver A", email: `loc-d-${stamp}@cafe.test`, passwordHash: "scrypt:test:00" },
  });
  try {
    const refused = await beginSignup(
      { name: "No Place", email: signupEmail, password: "Cafe1!", workplace: null },
      async () => {},
    );
    assert(!refused.ok, "signup without a workplace is refused");
    let mailed = "";
    const started = await beginSignup(
      {
        name: "With Place",
        email: signupEmail,
        password: "Cafe1!",
        workplace: { businessType: "cafe", useAsRouteOrigin: true, location: cafe },
      },
      async (_email, code) => {
        mailed = code;
      },
    );
    assert(started.ok, started.ok ? "code sent" : started.error);
    assert(!(await prisma.customer.findUnique({ where: { email: signupEmail } })), "no customer before the code");
    const confirmed = await confirmSignupCode({ email: signupEmail, code: mailed });
    assert(confirmed.ok, confirmed.ok ? "confirmed" : confirmed.error);
    if (confirmed.ok) signupCustomerId = confirmed.customer.id;
    const member = signupCustomerId
      ? await prisma.businessMember.findFirst({ where: { customerId: signupCustomerId, role: "owner" } })
      : null;
    assert(member, "workplace is saved with the account");

    const created = await createBusinessWorkspace(ownerA.id, {
      businessType: "cafe",
      useAsRouteOrigin: true,
      location: cafe,
    });
    assert(created.ok, created.ok ? "created" : created.error);
    const other = await createBusinessWorkspace(ownerB.id, {
      businessType: "bakery",
      useAsRouteOrigin: false,
      location: { ...branch, locationName: "Other Bakery" },
    });
    assert(other.ok, other.ok ? "other" : other.error);
    await prisma.businessMember.create({
      data: { businessId: created.businessId, customerId: driver.id, role: "driver" },
    });

    const denied = await updateBusinessLocation(driver.id, created.locationId, { locationName: "Hacked" });
    assert(!denied.ok && denied.status === 403, "driver cannot edit");
    const crossed = await updateBusinessLocation(ownerB.id, created.locationId, { locationName: "Stolen" });
    assert(!crossed.ok && crossed.status === 404, "other tenant cannot edit");
    const still = await prisma.businessLocation.findUnique({ where: { id: created.locationId } });
    assert(still?.locationName === "Check Cafe", "name unchanged");

    const added = await addBusinessLocation(ownerA.id, { location: branch });
    assert(added.ok, added.ok ? "branch" : added.error);
    const switched = await updateBusinessLocation(ownerA.id, added.locationId, { makeDefaultOrigin: true });
    assert(switched.ok && switched.location.isDefaultRouteOrigin, "new origin");
    const flags = await prisma.businessLocation.findMany({
      where: { businessId: created.businessId },
      select: { isDefaultRouteOrigin: true, isPrimary: true },
    });
    assert(flags.filter((row) => row.isDefaultRouteOrigin).length === 1, "one default origin");
    assert(flags.filter((row) => row.isPrimary).length === 1, "one primary");

    process.env.GOOGLE_MAPS_API_KEY = "test-only";
    const routed = await estimateBusinessRoute(ownerA.id, {
      kind: "purchasing_loop",
      origin: { mode: "default" },
      stops: [{ latitude: 43.81163, longitude: -79.45116, label: "Supplier" }],
      returnToOrigin: true,
      baseline: { distanceKm: 1, durationHours: 0.1 },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ routes: [{ distanceMeters: 15000, duration: "1200s" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    });
    assert(routed.ok, routed.ok ? "route" : routed.error);
    if (!routed.ok) return;
    assert(routed.origin.latitude === branch.latitude, "route starts at the default branch");
    assert(routed.route.distanceKm === 15, `km ${routed.route.distanceKm}`);
    assert(routed.incrementalTotal > 0, "incremental transport");
    const snapshotBefore = await prisma.routeSnapshot.findUnique({ where: { id: routed.snapshotId } });
    await updateBusinessLocation(ownerA.id, added.locationId, { latitude: 43.9, longitude: -79.5 });
    const snapshotAfter = await prisma.routeSnapshot.findUnique({ where: { id: routed.snapshotId } });
    assert(snapshotAfter?.originLat === snapshotBefore?.originLat, "history keeps the old origin");
    assert(snapshotAfter?.originLat === branch.latitude, "snapshot lat");

    const again = await createBusinessWorkspace(ownerA.id, {
      businessType: "cafe",
      useAsRouteOrigin: true,
      location: cafe,
    });
    assert(!again.ok && again.status === 409, "second workspace blocked");
    console.log("business location self-check ok");
  } finally {
    if (savedKey) process.env.GOOGLE_MAPS_API_KEY = savedKey;
    else delete process.env.GOOGLE_MAPS_API_KEY;
    const ids = [ownerA.id, ownerB.id, driver.id, signupCustomerId].filter((id): id is string => Boolean(id));
    await prisma.signupCode.deleteMany({ where: { email: signupEmail } });
    const memberships = await prisma.businessMember.findMany({ where: { customerId: { in: ids } } });
    const businessIds = [...new Set(memberships.map((row) => row.businessId))];
    if (businessIds.length) await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: ids } } });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
