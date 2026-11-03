"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { findActivityDay, subscribeActivity } from "@/lib/activity-log";
import type { Day } from "../data";
import { ActivityDay } from "./ActivityDay";

export function ActivityDayLoader({
  date,
  seed,
}: {
  date: string;
  seed: Day | null;
}) {
  const [day, setDay] = useState<Day | null>(seed);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const refresh = () => {
      setDay(findActivityDay(date) ?? seed);
      setReady(true);
    };
    refresh();
    return subscribeActivity(refresh);
  }, [date, seed]);

  if (!ready && !day) {
    return (
      <p style={{ padding: "2rem 1rem", opacity: 0.7 }}>Завантаження…</p>
    );
  }

  if (!day) {
    return (
      <div style={{ padding: "2rem 1rem", maxWidth: 820, margin: "0 auto" }}>
        <p style={{ margin: 0 }}>
          Немає запису за цю дату. Здай закупівлю в розділі{" "}
          <Link href="/driver" style={{ color: "#2f4a3a", fontWeight: 700 }}>
            Водій
          </Link>
          .
        </p>
        <p style={{ marginTop: "0.8rem" }}>
          <Link href="/activity" style={{ color: "#2f4a3a" }}>
            ‹ Історія покупок
          </Link>
        </p>
      </div>
    );
  }

  return <ActivityDay day={day} />;
}
