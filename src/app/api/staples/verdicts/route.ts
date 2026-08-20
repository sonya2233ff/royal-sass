import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  mergeOfferVerdictMaps,
  parseOfferVerdictMap,
} from "@/domain/offer-verdicts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE = path.join(
  process.cwd(),
  "data",
  "catalog",
  "operator-verdicts.json",
);

async function readDisk() {
  try {
    const raw = await readFile(FILE, "utf8");
    return parseOfferVerdictMap(JSON.parse(raw) as unknown);
  } catch {
    return {};
  }
}

export async function GET() {
  try {
    const raw = await readFile(FILE, "utf8");
    const verdicts = parseOfferVerdictMap(JSON.parse(raw) as unknown);
    return NextResponse.json({
      ok: true,
      persisted: true,
      verdicts,
    });
  } catch {
    return NextResponse.json({ ok: true, persisted: false, verdicts: {} });
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as unknown;
  const incoming = parseOfferVerdictMap(body);
  if (!Object.keys(incoming).length) {
    return NextResponse.json(
      { ok: false, error: "no verdicts" },
      { status: 400 },
    );
  }

  let persisted = false;
  try {
    const merged = mergeOfferVerdictMaps(await readDisk(), incoming);
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(
      FILE,
      `${JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          verdicts: merged,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    persisted = true;
    return NextResponse.json({
      ok: true,
      persisted,
      count: Object.keys(merged).length,
      verdicts: merged,
    });
  } catch {
    return NextResponse.json({
      ok: true,
      persisted: false,
      count: Object.keys(incoming).length,
      verdicts: incoming,
    });
  }
}
