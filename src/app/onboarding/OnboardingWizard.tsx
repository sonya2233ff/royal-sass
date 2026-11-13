"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchSession } from "@/lib/account-auth";
import { PlaceSearch, type PlaceDetails } from "./PlaceSearch";

const TYPES = [
  { id: "restaurant", label: "Ресторан" },
  { id: "cafe", label: "Кафе" },
  { id: "bakery", label: "Пекарня" },
  { id: "other_food_service", label: "Інший заклад харчування" },
] as const;

type Step = "type" | "find" | "manual" | "review" | "origin";

type Draft = PlaceDetails;

const EMPTY_MANUAL = {
  locationName: "",
  streetAddress: "",
  city: "",
  province: "ON",
  postalCode: "",
  country: "Canada",
};

function mapSrc(lat: number, lng: number): string {
  const pad = 0.012;
  const bbox = [lng - pad, lat - pad, lng + pad, lat + pad].join("%2C");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`;
}

export function OnboardingWizard({
  onChosen,
}: {
  /** When set, the cafe is chosen during registration and the account is not created here. */
  onChosen?: (choice: {
    businessType: string;
    useAsRouteOrigin: boolean;
    location: PlaceDetails;
  }) => Promise<void>;
} = {}) {
  const embedded = Boolean(onChosen);
  const router = useRouter();
  const [ready, setReady] = useState(embedded);
  const [signedIn, setSignedIn] = useState(embedded);
  const [step, setStep] = useState<Step>("type");
  const [businessType, setBusinessType] = useState<string>("cafe");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [manual, setManual] = useState(EMPTY_MANUAL);
  const [useOrigin, setUseOrigin] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (embedded) return;
    let cancelled = false;
    fetchSession().then(async (customer) => {
      if (cancelled) return;
      if (!customer) {
        setSignedIn(false);
        setReady(true);
        return;
      }
      setSignedIn(true);
      const res = await fetch("/api/business");
      if (res.ok) {
        const data = (await res.json()) as { ok?: boolean };
          if (data.ok) {
          router.replace("/profile");
          return;
        }
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [embedded, router]);

  async function geocode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/places/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(manual),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        place?: Omit<Draft, "source" | "locationName">;
      };
      if (!data.ok || !data.place) {
        setError(data.error ?? "Адресу не вдалося перевірити.");
        return;
      }
      setDraft({
        ...data.place,
        locationName: manual.locationName.trim(),
        source: "manual",
        googlePlaceId: null,
      });
      setStep("review");
    } finally {
      setBusy(false);
    }
  }

  function nudge(latDelta: number, lngDelta: number) {
    setDraft((current) =>
      current
        ? {
            ...current,
            latitude: Math.round((current.latitude + latDelta) * 1e6) / 1e6,
            longitude: Math.round((current.longitude + lngDelta) * 1e6) / 1e6,
          }
        : current,
    );
  }

  async function createWorkspace() {
    if (!draft || useOrigin == null) return;
    setBusy(true);
    setError(null);
    const location = {
      ...draft,
      formattedAddress:
        draft.formattedAddress ||
        [draft.streetAddress, draft.city, draft.province, draft.postalCode, draft.country].filter(Boolean).join(", "),
    };
    try {
      if (onChosen) {
        await onChosen({ businessType, useAsRouteOrigin: useOrigin, location });
        return;
      }
      const res = await fetch("/api/business", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessType, useAsRouteOrigin: useOrigin, location }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "Не вдалося створити заклад.");
        return;
      }
      router.push("/profile");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не вдалося продовжити.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={embedded ? "embed" : "screen"}>
      <div className="sheet">
        {!embedded && (
        <Link href="/" className="back">
          ‹ Кафе
        </Link>
        )}
        {!embedded && <p className="kicker">Заклад</p>}
        {!embedded && <h1>Де ви працюєте</h1>}
        <p className="lede">
          Знайди ресторан або кафе, перевір адресу і обери, чи звідси починаються закупівлі.
        </p>
        {!ready && <p className="muted">Завантаження…</p>}
        {ready && !signedIn && (
          <p>
            Спочатку створи акаунт. <Link href="/register">Реєстрація</Link>
          </p>
        )}
        {ready && signedIn && step === "type" && (
          <div className="stack">
            <p className="label">Тип закладу</p>
            <div className="types">
              {TYPES.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  className={businessType === type.id ? "choice on" : "choice"}
                  aria-pressed={businessType === type.id}
                  onClick={() => setBusinessType(type.id)}
                >
                  {type.label}
                </button>
              ))}
            </div>
            <button type="button" className="solid" onClick={() => setStep("find")}>
              Далі
            </button>
          </div>
        )}
        {ready && signedIn && step === "find" && (
          <PlaceSearch onPick={(place) => { setDraft(place); setStep("review"); }} onManual={() => setStep("manual")} />
        )}
        {ready && signedIn && step === "manual" && (
          <form className="stack" onSubmit={(event) => void geocode(event)}>
            {(
              [
                ["locationName", "Назва закладу"],
                ["streetAddress", "Вулиця і номер"],
                ["city", "Місто"],
                ["province", "Провінція"],
                ["postalCode", "Поштовий індекс"],
                ["country", "Країна"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  value={manual[key]}
                  required
                  onChange={(event) => setManual((current) => ({ ...current, [key]: event.target.value }))}
                />
              </label>
            ))}
            {error && <p className="err">{error}</p>}
            <button type="submit" className="solid" disabled={busy}>
              {busy ? "Перевіряю…" : "Перевірити адресу"}
            </button>
            <button type="button" className="ghost" onClick={() => setStep("find")}>
              Назад до пошуку
            </button>
          </form>
        )}
        {ready && signedIn && step === "review" && draft && (
          <div className="stack">
            {(
              [
                ["locationName", "Назва"],
                ["streetAddress", "Вулиця і номер"],
                ["city", "Місто"],
                ["province", "Провінція"],
                ["postalCode", "Поштовий індекс"],
                ["country", "Країна"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  value={draft[key]}
                  onChange={(event) => {
                    const next = { ...draft, [key]: event.target.value };
                    if (key !== "locationName") {
                      next.source = "manual";
                      next.googlePlaceId = null;
                      next.formattedAddress = [next.streetAddress, next.city, next.province, next.postalCode, next.country]
                        .filter(Boolean)
                        .join(", ");
                    }
                    setDraft(next);
                  }}
                />
              </label>
            ))}
            <p className="muted">
              {draft.latitude.toFixed(5)}, {draft.longitude.toFixed(5)}
            </p>
            <iframe title="Мапа адреси" src={mapSrc(draft.latitude, draft.longitude)} />
            <div className="nudge">
              <button type="button" onClick={() => nudge(0.0004, 0)}>Північ</button>
              <button type="button" onClick={() => nudge(-0.0004, 0)}>Південь</button>
              <button type="button" onClick={() => nudge(0, -0.0004)}>Захід</button>
              <button type="button" onClick={() => nudge(0, 0.0004)}>Схід</button>
            </div>
            <a href={`https://www.google.com/maps/search/?api=1&query=${draft.latitude},${draft.longitude}`} target="_blank" rel="noreferrer">
              Відкрити в Google Maps
            </a>
            {draft.source === "google_places" && <p className="muted">Адресу знайдено через Google. Це не підтверджує, що акаунт володіє закладом.</p>}
            <button type="button" className="solid" onClick={() => setStep("origin")}>
              Адреса правильна
            </button>
            <button type="button" className="ghost" onClick={() => setStep("find")}>
              Обрати інший заклад
            </button>
          </div>
        )}
        {ready && signedIn && step === "origin" && (
          <div className="stack">
            <p className="question">Використати цю адресу як початкову точку для закупівель і маршрутів самовивозу?</p>
            <div className="types">
              <button type="button" className={useOrigin === true ? "choice on" : "choice"} aria-pressed={useOrigin === true} onClick={() => setUseOrigin(true)}>
                Так
              </button>
              <button type="button" className={useOrigin === false ? "choice on" : "choice"} aria-pressed={useOrigin === false} onClick={() => setUseOrigin(false)}>
                Ні
              </button>
            </div>
            {error && <p className="err">{error}</p>}
            <button type="button" className="solid" disabled={busy || useOrigin == null} onClick={() => void createWorkspace()}>
              {busy ? "…" : embedded ? "Далі" : "Створити заклад"}
            </button>
          </div>
        )}
      </div>
      <style jsx>{`
        .embed .sheet {
          width: 100%;
          padding: 0;
        }
        .screen {
          min-height: calc(100vh - 3.2rem);
          background:
            radial-gradient(900px 480px at 100% -10%, #e4ddd0 0%, transparent 55%),
            linear-gradient(165deg, #f7f3ec 0%, #ebe4d6 48%, #f3eee4 100%);
          font-family: "Segoe UI", "Candara", "Gill Sans", sans-serif;
          color: #1e2820;
        }
        .sheet {
          width: min(40rem, 100%);
          margin: 0 auto;
          padding: 2.2rem 1.25rem 4rem;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .kicker {
          margin: 0.6rem 0 0;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          font-size: 0.72rem;
          font-weight: 700;
          color: #2f4a3a;
        }
        h1 {
          margin: 0;
          font-size: clamp(2rem, 5vw, 3rem);
          line-height: 1.05;
        }
        .lede, .muted, .question, .address {
          margin: 0;
          line-height: 1.45;
        }
        .lede { color: #3d4a40; }
        .muted { color: #5c6b60; font-size: 0.92rem; }
        .question { font-size: 1.15rem; font-weight: 700; }
        .stack { display: grid; gap: 0.75rem; }
        .label { margin: 0; font-size: 0.82rem; font-weight: 700; color: #2f4a3a; }
        .types, .nudge { display: flex; flex-wrap: wrap; gap: 0.45rem; }
        .choice, .nudge button, .solid, .ghost {
          font: inherit;
          font-weight: 700;
          border-radius: 999px;
          padding: 0.7rem 1rem;
          cursor: pointer;
        }
        .choice, .nudge button, .ghost {
          background: #fffdf8;
          color: #2f4a3a;
          border: 1px solid rgba(47, 74, 58, 0.28);
        }
        .choice.on { background: #2f4a3a; color: #f7f3ec; }
        .solid {
          background: #2f4a3a;
          color: #f7f3ec;
          border: 1px solid #2f4a3a;
        }
        .solid:disabled { opacity: 0.55; cursor: default; }
        label { display: grid; gap: 0.35rem; font-size: 0.82rem; font-weight: 700; color: #2f4a3a; }
        input {
          font: inherit;
          font-size: 1.02rem;
          font-weight: 500;
          padding: 0.7rem 0.8rem;
          border-radius: 12px;
          border: 1px solid rgba(47, 74, 58, 0.28);
          background: #fffdf8;
        }
        iframe { width: 100%; height: 220px; border: 0; border-radius: 12px; background: #e7eee8; }
        .err { margin: 0; color: #8a2b22; }
        :global(a) { color: #2f4a3a; font-weight: 700; }
      `}</style>
    </section>
  );
}
