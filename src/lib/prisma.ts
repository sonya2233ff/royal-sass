import { PrismaClient } from "@prisma/client";
import { resolveDatabaseUrl } from "@/lib/database-url";

const resolved = resolveDatabaseUrl();
if (resolved) process.env.DATABASE_URL = resolved;
if (!process.env.DIRECT_URL && process.env.POSTGRES_URL_NON_POOLING) {
  process.env.DIRECT_URL = process.env.POSTGRES_URL_NON_POOLING;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
