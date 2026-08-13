import { discoverFreshCoEndpoints } from "@/connectors/freshco";

async function main() {
  const postal = process.argv[2] ?? "M1P2L8";
  const result = await discoverFreshCoEndpoints(postal);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
