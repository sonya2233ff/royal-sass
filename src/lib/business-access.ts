import { customerFromToken } from "@/lib/customer-auth";
import { readCustomerToken } from "@/lib/customer-cookie";
import { prisma } from "@/lib/prisma";

export type MemberRole = "owner" | "waiter" | "driver";

export type BusinessActor = {
  customerId: string;
  businessId: string;
  role: MemberRole;
};

const ROLES: MemberRole[] = ["owner", "waiter", "driver"];

export function asRole(value: string): MemberRole | null {
  return ROLES.includes(value as MemberRole) ? (value as MemberRole) : null;
}

export async function requireCustomer(): Promise<{ id: string } | null> {
  const customer = await customerFromToken(await readCustomerToken());
  return customer ? { id: customer.id } : null;
}

/** The caller's workspace. A customer with several memberships uses the owned one. */
export async function actorForCustomer(customerId: string): Promise<BusinessActor | null> {
  const rows = await prisma.businessMember.findMany({
    where: { customerId },
    orderBy: { createdAt: "asc" },
  });
  if (!rows.length) return null;
  const preferred = rows.find((row) => row.role === "owner") ?? rows[0];
  const role = asRole(preferred.role);
  if (!role) return null;
  return { customerId, businessId: preferred.businessId, role };
}

export async function requireMember(): Promise<BusinessActor | null> {
  const customer = await requireCustomer();
  if (!customer) return null;
  return actorForCustomer(customer.id);
}

export function canEditLocations(role: MemberRole): boolean {
  return role === "owner";
}
