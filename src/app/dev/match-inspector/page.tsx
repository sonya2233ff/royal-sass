import { notFound } from "next/navigation";
import { inspectorEnabled } from "@/lib/match-inspector";
import { MatchInspectorClient } from "./MatchInspectorClient";

export const dynamic = "force-dynamic";

export default function MatchInspectorPage() {
  if (!inspectorEnabled()) notFound();
  return <MatchInspectorClient />;
}
