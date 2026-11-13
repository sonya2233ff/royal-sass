"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchSession } from "@/lib/account-auth";
import { PlaceSearch, type PlaceDetails } from "../onboarding/PlaceSearch";

type Location = {
  id: string;
  locationName: string;
  formattedAddress: string | null;
  streetAddress: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  isPrimary: boolean;
  isDefaultRouteOrigin: boolean;
  source: string;
  needsRefresh: boolean;
  attribution: "google" | null;
};

type Transport = {
  fuelLitresPer100Km: number;
  fuelPricePerLitre: number;
  driverHourlyCost: number;
  vehicleCostPerKm: number | null;
  useInclusiveVehicleCost: boolean;
  parkingCost: number;
  tollCost: number;
};

type Overview = {
  business: { id: string; name: string; businessType: string };
  role: "owner" | "waiter" | "driver";
  locations: Location[];
  transport: Transport;
};

function mapSrc(lat: number, lng: number): string {
  const pad = 0.012;
  const bbox = [lng - pad, lat - pad, lng + pad, lat + pad].join("%2C");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`;
}

export function BusinessLocationScreen({ section = "profile" }: { section?: "profile" | "settings" }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [missing, setMissing] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [manual, setManual] = useState({
    locationName: "",
    streetAddress: "",
    city: "",
    province: "ON",
    postalCode: "",
    country: "Canada",
  });
  const [transport, setTransport] = useState<Transport | null>(null);

  async function load() {
    const customer = await fetchSession();
    if (!customer) {
      setSignedOut(true);
      return;
    }
    const res = await fetch("/api/business");
    const data = (await res.json().catch(() => ({}))) as Overview & { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      setMissing(true);
      setError(data.error ?? null);
      return;
    }
    setOverview(data);
    setTransport(data.transport);
    setMissing(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const owner = overview?.role === "owner";

  async function makeOrigin(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/business/locations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ makeDefaultOrigin: true }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "Не вдалося змінити початок маршруту.");
        return;
      }
      setNotice("Початок маршруту оновлено. Старі розрахунки не змінюються.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function addPlace(place: PlaceDetails, makeDefaultOrigin: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/business/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: place, makeDefaultOrigin }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "Не вдалося додати філію.");
        return;
      }
      setAdding(false);
      setNotice("Філію додано.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function geocodeBranch(event: React.FormEvent) {
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
        place?: Omit<PlaceDetails, "source" | "locationName">;
      };
      if (!data.ok || !data.place) {
        setError(data.error ?? "Адресу не вдалося перевірити.");
        return;
      }
      await addPlace(
        { ...data.place, locationName: manual.locationName.trim(), source: "manual", googlePlaceId: null },
        false,
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveTransport(event: React.FormEvent) {
    event.preventDefault();
    if (!transport) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/business/transport", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(transport),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; transport?: Transport };
      if (!data.ok || !data.transport) {
        setError(data.error ?? "Не вдалося зберегти витрати.");
        return;
      }
      setTransport(data.transport);
      setNotice("Витрати на дорогу збережено.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="screen">
      <div className="sheet">
        <p className="kicker">{section === "settings" ? "Налаштування" : "Профіль"}</p>
        {signedOut && (
          <p>
            Увійди, щоб бачити адресу. <Link href="/login">Вхід</Link>
          </p>
        )}
        {missing && (
          <p>
            {error ?? "Заклад ще не створено."} <Link href="/register">Реєстрація</Link>
          </p>
        )}
        {overview && (
          <>
            <h1>{section === "settings" ? "Налаштування" : overview.business.name}</h1>
            <p className="lede">
              {section === "settings"
                ? "Ці параметри бачить лише твій заклад. Вони рахують дорогу і не змінюють ціни товарів."
                : owner
                  ? "Цю адресу бачить лише твій заклад. Зміна адреси не переписує вже пораховані маршрути."
                  : "Адресу і початок маршруту може змінювати лише власник."}
            </p>
            {notice && <p className="notice">{notice}</p>}
            {error && <p className="err">{error}</p>}
            {section === "profile" && <div className="cards">
              {overview.locations.map((location) => (
                <article key={location.id} className="card">
                  <h2>
                    {location.locationName}
                    {location.isPrimary ? " · основна" : ""}
                    {location.isDefaultRouteOrigin ? " · старт маршруту" : ""}
                  </h2>
                  {location.needsRefresh ? (
                    <p>Дані Google для цієї адреси треба оновити. Ключ карт зараз недоступний, тому адресу приховано.</p>
                  ) : (
                    <p>{location.formattedAddress}</p>
                  )}
                  {location.latitude != null && location.longitude != null && (
                    <>
                      <p className="muted">
                        {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
                      </p>
                      <iframe title={location.locationName} src={mapSrc(location.latitude, location.longitude)} />
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Відкрити в Google Maps
                      </a>
                    </>
                  )}
                  {location.attribution === "google" && <p className="muted">Адреса з Google</p>}
                  {owner && !location.isDefaultRouteOrigin && (
                    <button type="button" className="ghost" disabled={busy} onClick={() => void makeOrigin(location.id)}>
                      Зробити початком маршруту
                    </button>
                  )}
                </article>
              ))}
            </div>}
            {section === "profile" && owner && (
              <>
                <button type="button" className="ghost" onClick={() => setAdding((value) => !value)}>
                  {adding ? "Сховати форму філії" : "Додати філію"}
                </button>
                {adding && (
                  <div className="stack">
                    <PlaceSearch onPick={(place) => void addPlace(place, false)} />
                    <form className="stack" onSubmit={(event) => void geocodeBranch(event)}>
                      <h2>Або адреса вручну</h2>
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
                            value={manual[key]}
                            required
                            onChange={(event) => setManual((current) => ({ ...current, [key]: event.target.value }))}
                          />
                        </label>
                      ))}
                      <button type="submit" className="solid" disabled={busy}>
                        Перевірити і додати
                      </button>
                    </form>
                  </div>
                )}
              </>
            )}
            {section === "settings" && owner && transport && (
                  <form className="stack" onSubmit={(event) => void saveTransport(event)}>
                    <h2>Витрати на дорогу</h2>
                    <p className="muted">
                      Паливо = км × витрати л/100 км ÷ 100 × ціна літра. Якщо увімкнено повну ціну за км, паливо окремо не додається.
                    </p>
                    <label>
                      Витрата, л/100 км
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        value={transport.fuelLitresPer100Km}
                        onChange={(event) => setTransport({ ...transport, fuelLitresPer100Km: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      Ціна палива, $ / л
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={transport.fuelPricePerLitre}
                        onChange={(event) => setTransport({ ...transport, fuelPricePerLitre: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      Водій, $ / год
                      <input
                        type="number"
                        min={0}
                        step="0.5"
                        value={transport.driverHourlyCost}
                        onChange={(event) => setTransport({ ...transport, driverHourlyCost: Number(event.target.value) })}
                      />
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={transport.useInclusiveVehicleCost}
                        onChange={(event) => setTransport({ ...transport, useInclusiveVehicleCost: event.target.checked })}
                      />
                      Рахувати повну ціну авто за км замість палива
                    </label>
                    <label>
                      Ціна авто, $ / км
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={transport.vehicleCostPerKm ?? ""}
                        onChange={(event) =>
                          setTransport({
                            ...transport,
                            vehicleCostPerKm: event.target.value === "" ? null : Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label>
                      Паркування, $
                      <input
                        type="number"
                        min={0}
                        step="0.5"
                        value={transport.parkingCost}
                        onChange={(event) => setTransport({ ...transport, parkingCost: Number(event.target.value) })}
                      />
                    </label>
                    <label>
                      Дорожні збори, $
                      <input
                        type="number"
                        min={0}
                        step="0.5"
                        value={transport.tollCost}
                        onChange={(event) => setTransport({ ...transport, tollCost: Number(event.target.value) })}
                      />
                    </label>
                    <button type="submit" className="solid" disabled={busy}>
                      Зберегти витрати
                    </button>
                  </form>
            )}
          </>
        )}
      </div>
      <style jsx>{`
        .screen {
          min-height: calc(100vh - 3.2rem);
          background:
            radial-gradient(900px 480px at 0% -10%, #d9e4d8 0%, transparent 50%),
            linear-gradient(165deg, #f7f3ec 0%, #ebe4d6 100%);
          font-family: "Segoe UI", "Candara", "Gill Sans", sans-serif;
          color: #1e2820;
        }
        .sheet {
          width: min(46rem, 100%);
          margin: 0 auto;
          padding: 2rem 1.25rem 4rem;
          display: flex;
          flex-direction: column;
          gap: 0.8rem;
        }
        .kicker {
          margin: 0;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          font-size: 0.72rem;
          font-weight: 700;
          color: #2f4a3a;
        }
        h1 { margin: 0; font-size: clamp(2rem, 5vw, 2.8rem); }
        h2 { margin: 0; font-size: 1.15rem; }
        .lede, .muted, .notice { margin: 0; line-height: 1.45; }
        .muted { color: #5c6b60; font-size: 0.92rem; }
        .notice { color: #2f6a3a; font-weight: 700; }
        .err { margin: 0; color: #8a2b22; }
        .cards, .stack { display: grid; gap: 0.8rem; }
        .card {
          background: #fffdf8;
          border: 1px solid rgba(47, 74, 58, 0.14);
          border-radius: 16px;
          padding: 0.9rem;
          display: grid;
          gap: 0.55rem;
        }
        iframe { width: 100%; height: 200px; border: 0; border-radius: 12px; }
        label { display: grid; gap: 0.3rem; font-size: 0.82rem; font-weight: 700; color: #2f4a3a; }
        .check { grid-template-columns: auto 1fr; align-items: center; }
        input[type="number"], input:not([type="checkbox"]) {
          font: inherit;
          font-size: 1rem;
          padding: 0.65rem 0.75rem;
          border-radius: 12px;
          border: 1px solid rgba(47, 74, 58, 0.28);
          background: #fffdf8;
        }
        .solid, .ghost {
          justify-self: start;
          font: inherit;
          font-weight: 700;
          border-radius: 999px;
          padding: 0.7rem 1rem;
          cursor: pointer;
        }
        .solid { background: #2f4a3a; color: #f7f3ec; border: 1px solid #2f4a3a; }
        .ghost { background: transparent; color: #2f4a3a; border: 1px solid rgba(47, 74, 58, 0.35); }
        :global(a) { color: #2f4a3a; font-weight: 700; }
      `}</style>
    </section>
  );
}
