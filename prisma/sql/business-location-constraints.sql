-- One primary location and one default route origin per business.
-- SQLite stores booleans as 0/1. Multiple false rows remain allowed.
CREATE UNIQUE INDEX IF NOT EXISTS business_location_one_primary
  ON "BusinessLocation" ("businessId")
  WHERE "isPrimary" = 1;

CREATE UNIQUE INDEX IF NOT EXISTS business_location_one_default_origin
  ON "BusinessLocation" ("businessId")
  WHERE "isDefaultRouteOrigin" = 1;

CREATE UNIQUE INDEX IF NOT EXISTS business_member_one_owned_workspace
  ON "BusinessMember" ("customerId")
  WHERE "role" = 'owner';
