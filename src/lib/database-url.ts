/** Local dev uses SQLite. Vercel needs a Postgres URL; a file: URL cannot store accounts there. */

export function resolveDatabaseUrl(): string | undefined {
  const current = process.env.DATABASE_URL?.trim();
  if (current) return current;
  return process.env.POSTGRES_PRISMA_URL?.trim() || process.env.POSTGRES_URL?.trim() || undefined;
}

export function databaseConfigError(): string | null {
  const url = resolveDatabaseUrl();
  if (!url) {
    return "База даних не налаштована на цьому сервері. На Vercel додай Postgres і DATABASE_URL, потім задеплой ще раз.";
  }
  if (process.env.VERCEL && url.startsWith("file:")) {
    return "Файл SQLite на Vercel не зберігає акаунти. Додай Postgres DATABASE_URL.";
  }
  return null;
}

export function publicDbError(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("Environment variable not found: DATABASE_URL") || message.includes("Can't reach database server")) {
    return databaseConfigError() ?? "База даних не налаштована на цьому сервері.";
  }
  return null;
}
