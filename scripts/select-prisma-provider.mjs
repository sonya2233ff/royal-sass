import fs from "node:fs";

function fromEnvFile(name) {
  if (!fs.existsSync(".env")) return "";
  for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0 || trimmed.slice(0, eq) !== name) continue;
    return trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
  return "";
}

function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL ||
  fromEnvFile("DATABASE_URL");
const directUrl =
  process.env.DIRECT_URL || process.env.POSTGRES_URL_NON_POOLING || fromEnvFile("DIRECT_URL");
const postgres = databaseUrl.startsWith("postgres://") || databaseUrl.startsWith("postgresql://");

if (postgres) {
  const schemaPath = "prisma/schema.prisma";
  let schema = fs.readFileSync(schemaPath, "utf8");
  schema = schema.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"');
  if (!schema.includes("directUrl")) {
    schema = schema.replace(
      /url\s*=\s*env\("DATABASE_URL"\)/,
      'url       = env("DATABASE_URL")\n  directUrl = env("DIRECT_URL")',
    );
  }
  fs.writeFileSync(schemaPath, schema);
}

const lines = [`export PRISMA_PROVIDER=${postgres ? "postgresql" : "sqlite"}`];
if (databaseUrl && process.env.DATABASE_URL !== databaseUrl) {
  lines.push(`export DATABASE_URL=${shellQuote(databaseUrl)}`);
}
if (postgres) {
  lines.push(`export DIRECT_URL=${shellQuote(directUrl || databaseUrl)}`);
}
process.stdout.write(`${lines.join("\n")}\n`);
