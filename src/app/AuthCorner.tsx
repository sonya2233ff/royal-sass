"use client";

import { useEffect, useId, useState } from "react";
import {
  loadAccountStore,
  loginInto,
  logoutStore,
  registerInto,
  writeAccountStore,
  type AccountPublic,
} from "@/lib/account-auth";

type Mode = "login" | "register";

export function AuthCorner() {
  const formId = useId();
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<AccountPublic | null>(null);
  const [open, setOpen] = useState<Mode | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAccount(loadAccountStore().session);
    setReady(true);
    const onStorage = () => setAccount(loadAccountStore().session);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function openMode(mode: Mode) {
    setOpen(mode);
    setError(null);
    setPassword("");
  }

  function close() {
    setOpen(null);
    setError(null);
    setPassword("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!open) return;
    setBusy(true);
    setError(null);
    try {
      const store = loadAccountStore();
      const result =
        open === "register"
          ? await registerInto(store, { name, email, password })
          : await loginInto(store, { email, password });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      writeAccountStore(result.store);
      setAccount(result.account);
      setPassword("");
      setOpen(null);
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    const store = loadAccountStore();
    writeAccountStore(logoutStore(store));
    setAccount(null);
    setOpen(null);
  }

  return (
    <div className="auth">
      {account ? (
        <div className="who">
          <span className="name" title={account.email}>
            {account.name}
          </span>
          <button type="button" className="ghost" onClick={logout}>
            Вийти
          </button>
        </div>
      ) : (
        <div className="who">
          <button
            type="button"
            className="ghost"
            disabled={!ready}
            onClick={() => openMode("login")}
          >
            Увійти
          </button>
          <button
            type="button"
            className="solid"
            disabled={!ready}
            onClick={() => openMode("register")}
          >
            Реєстрація
          </button>
        </div>
      )}
      {open && (
        <form
          className="panel"
          id={formId}
          onSubmit={(e) => void submit(e)}
          aria-label={open === "register" ? "Реєстрація" : "Вхід"}
        >
          <strong>{open === "register" ? "Реєстрація" : "Вхід"}</strong>
          <p className="hint">Обліковий запис зберігається в цьому браузері.</p>
          {open === "register" && (
            <label>
              Ім&apos;я
              <input
                value={name}
                autoComplete="name"
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
          )}
          <label>
            Email
            <input
              type="email"
              value={email}
              autoComplete="email"
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label>
            Пароль
            <input
              type="password"
              value={password}
              autoComplete={open === "register" ? "new-password" : "current-password"}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </label>
          {error && <p className="err">{error}</p>}
          <div className="row">
            <button type="submit" className="solid" disabled={busy}>
              {busy ? "…" : open === "register" ? "Створити" : "Увійти"}
            </button>
            <button type="button" className="ghost" onClick={close}>
              Скасувати
            </button>
          </div>
        </form>
      )}
      <style jsx>{`
        .auth {
          margin-left: auto;
          position: relative;
          display: flex;
          align-items: center;
        }
        .who {
          display: flex;
          align-items: center;
          gap: 0.35rem;
        }
        .name {
          max-width: 9rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 0.88rem;
          font-weight: 700;
          color: #2f4a3a;
        }
        .ghost,
        .solid {
          font: inherit;
          font-size: 0.86rem;
          font-weight: 650;
          border-radius: 999px;
          padding: 0.32rem 0.75rem;
          cursor: pointer;
        }
        .ghost {
          background: transparent;
          color: #2f4a3a;
          border: 1px solid rgba(47, 74, 58, 0.35);
        }
        .solid {
          background: #2f4a3a;
          color: #f7f3ec;
          border: 1px solid #2f4a3a;
        }
        .ghost:disabled,
        .solid:disabled {
          opacity: 0.55;
          cursor: default;
        }
        .panel {
          position: absolute;
          top: calc(100% + 0.45rem);
          right: 0;
          z-index: 50;
          width: min(18rem, 80vw);
          display: grid;
          gap: 0.45rem;
          padding: 0.75rem;
          background: #fffdf8;
          border: 1px solid rgba(30, 40, 30, 0.16);
          border-radius: 12px;
          box-shadow: 0 10px 28px rgba(30, 40, 30, 0.12);
        }
        .panel strong {
          font-size: 0.95rem;
        }
        .hint {
          margin: 0;
          font-size: 0.75rem;
          color: #5c6b60;
        }
        label {
          display: grid;
          gap: 0.2rem;
          font-size: 0.75rem;
          font-weight: 700;
          color: #2f4a3a;
        }
        input {
          font: inherit;
          font-size: 0.9rem;
          font-weight: 500;
          padding: 0.4rem 0.5rem;
          border-radius: 8px;
          border: 1px solid rgba(47, 74, 58, 0.28);
          background: #fff;
        }
        .err {
          margin: 0;
          font-size: 0.78rem;
          color: #8a2b22;
        }
        .row {
          display: flex;
          gap: 0.35rem;
          justify-content: flex-end;
        }
      `}</style>
    </div>
  );
}
