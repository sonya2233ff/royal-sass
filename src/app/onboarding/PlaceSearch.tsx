"use client";

import { useEffect, useState } from "react";

export type PlaceDetails = {
  locationName: string;
  formattedAddress: string;
  streetAddress: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  latitude: number;
  longitude: number;
  googlePlaceId: string | null;
  source: "google_places" | "manual";
};

type Suggestion = { placeId: string; name: string; address: string };

export function PlaceSearch({
  onPick,
  onManual,
}: {
  onPick: (place: PlaceDetails) => void;
  onManual?: () => void;
}) {
  const [sessionToken, setSessionToken] = useState(() => crypto.randomUUID());
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setSuggestions([]);
      setEmpty(false);
      return;
    }
    const handle = window.setTimeout(() => {
      setBusy(true);
      setError(null);
      void fetch("/api/places/autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: trimmed, sessionToken }),
      })
        .then(async (res) => {
          const data = (await res.json().catch(() => ({}))) as {
            ok?: boolean;
            error?: string;
            suggestions?: Suggestion[];
          };
          if (!data.ok) {
            setSuggestions([]);
            setEmpty(false);
            setError(data.error ?? "Пошук зараз недоступний.");
            return;
          }
          const next = data.suggestions ?? [];
          setSuggestions(next);
          setEmpty(next.length === 0);
        })
        .catch(() => setError("Пошук зараз недоступний."))
        .finally(() => setBusy(false));
    }, 350);
    return () => window.clearTimeout(handle);
  }, [query, sessionToken]);

  async function choose(suggestion: Suggestion) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/places/details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId: suggestion.placeId, sessionToken }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        place?: Omit<PlaceDetails, "source">;
      };
      if (!data.ok || !data.place) {
        setError(data.error ?? "Не вдалося відкрити цей заклад.");
        return;
      }
      onPick({ ...data.place, source: "google_places" });
      setSessionToken(crypto.randomUUID());
      setQuery("");
      setSuggestions([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="search">
      <label>
        Назва або адреса
        <input
          value={query}
          autoComplete="off"
          placeholder="Наприклад, кафе на Yonge"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {busy && <p className="muted">Шукаю…</p>}
      {error && <p className="err">{error}</p>}
      {empty && !error && <p className="muted">Нічого не знайдено. Можна ввести адресу вручну.</p>}
      {suggestions.length > 0 && (
        <ul className="hits" role="listbox" aria-label="Знайдені заклади">
          {suggestions.map((suggestion) => (
            <li key={suggestion.placeId}>
              <button type="button" onClick={() => void choose(suggestion)}>
                <strong>{suggestion.name}</strong>
                {suggestion.address && <span>{suggestion.address}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
        <p className="credit">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png"
          alt="Powered by Google"
          height={16}
        />
      </p>
      {onManual && (
        <button type="button" className="ghost" onClick={onManual}>
          Ввести адресу вручну
        </button>
      )}
      <style jsx>{`
        .search {
          display: grid;
          gap: 0.75rem;
        }
        label {
          display: grid;
          gap: 0.35rem;
          font-size: 0.82rem;
          font-weight: 700;
          color: #2f4a3a;
        }
        input {
          font: inherit;
          font-size: 1.05rem;
          font-weight: 500;
          padding: 0.75rem 0.85rem;
          border-radius: 12px;
          border: 1px solid rgba(47, 74, 58, 0.28);
          background: #fffdf8;
        }
        .hits {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 0.4rem;
        }
        .hits button {
          width: 100%;
          text-align: left;
          font: inherit;
          background: #fffdf8;
          border: 1px solid rgba(47, 74, 58, 0.18);
          border-radius: 12px;
          padding: 0.7rem 0.8rem;
          cursor: pointer;
        }
        .hits strong,
        .hits span {
          display: block;
        }
        .hits span {
          margin-top: 0.15rem;
          color: #5c6b60;
          font-size: 0.9rem;
        }
        .muted {
          margin: 0;
          color: #5c6b60;
        }
        .err {
          margin: 0;
          color: #8a2b22;
        }
        .credit {
          margin: 0;
        }
        .ghost {
          justify-self: start;
          font: inherit;
          font-weight: 700;
          background: transparent;
          color: #2f4a3a;
          border: 1px solid rgba(47, 74, 58, 0.35);
          border-radius: 999px;
          padding: 0.65rem 1rem;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
