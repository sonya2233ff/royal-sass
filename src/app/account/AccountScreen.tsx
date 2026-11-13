"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  fetchSession,
  loginAccount,
  logoutAccount,
  registerAccount,
  resendSignupCode,
  verifySignupCode,
  type AccountPublic,
} from "@/lib/account-auth";
import { passwordConfirmError, passwordRuleError } from "@/lib/password-rules";

type Mode = "login" | "register";

export function AccountScreen({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [account, setAccount] = useState<AccountPublic | null>(null);
  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSession().then((customer) => {
      if (cancelled) return;
      setAccount(customer);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "register") {
        const passwordError = passwordRuleError(password) ?? passwordConfirmError(password, confirmPassword);
        if (passwordError) {
          setError(passwordError);
          return;
        }
      }
      if (mode === "register") {
        const result = await registerAccount({ name, email, password, confirmPassword });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setAwaitingCode(true);
        setNotice(`Код надіслано на ${result.email}. Він діє 30 хвилин.`);
        return;
      }
      const result = await loginAccount({ email, password });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAccount(result.customer);
      router.push("/");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await verifySignupCode({ email, code });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAccount(result.customer);
      router.push("/onboarding");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      const result = await resendSignupCode(email);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCode("");
      setNotice(`Новий код надіслано на ${email}. Попередній більше не діє. Код активний 30 хвилин.`);
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    void logoutAccount().then(() => {
      setAccount(null);
      setPassword("");
      setConfirmPassword("");
    });
  }

  const title = mode === "register" ? "Реєстрація" : "Вхід";
  const otherHref = mode === "register" ? "/login" : "/register";
  const otherLabel = mode === "register" ? "Вже є акаунт? Увійти" : "Немає акаунта? Реєстрація";

  return (
    <section className="screen" aria-labelledby="account-title">
      <div className="sheet">
        <Link href="/" className="back">
          ‹ Кафе
        </Link>
        <p className="kicker">Royal SASS</p>
        <h1 id="account-title">{awaitingCode ? "Код з листа" : title}</h1>
        <p className="lede">
          {awaitingCode
            ? "Введи код з листа. Він діє 30 хвилин. Після підтвердження акаунт зберігається в базі."
            : "Ім’я та email зберігаються в базі кафе після підтвердження коду з листа. Пароль туди не записується відкритим текстом."}
        </p>

        {ready && account ? (
          <div className="signed">
            <p>
              Зараз увійшов <strong>{account.name}</strong>
              <span> · {account.email}</span>
            </p>
            <div className="row">
              <Link href="/" className="solid linkish">
                До товарів
              </Link>
              <button type="button" className="ghost" onClick={logout}>
                Вийти
              </button>
            </div>
          </div>
        ) : awaitingCode && mode === "register" ? (
          <form onSubmit={(e) => void submitCode(e)}>
            {notice && <p className="notice">{notice}</p>}
            <label>
              Код
              <input
                value={code}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
              />
            </label>
            {error && <p className="err">{error}</p>}
            <button type="submit" className="solid" disabled={!ready || busy || code.length < 6}>
              {busy ? "…" : "Підтвердити"}
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => void resend()}>
              Надіслати код ще раз
            </button>
          </form>
        ) : (
          <form onSubmit={(e) => void submit(e)}>
            {mode === "register" && (
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
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                minLength={mode === "register" ? 6 : undefined}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {mode === "register" && (
              <label>
                Повторіть пароль
                <input
                  type="password"
                  value={confirmPassword}
                  autoComplete="new-password"
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </label>
            )}
            {mode === "register" && (
              <ul className="rules">
                <li>починається з великої літери</li>
                <li>є хоча б одна літера</li>
                <li>є хоча б один спеціальний символ</li>
                <li>щонайменше 6 символів</li>
                <li>обидва поля пароля однакові</li>
              </ul>
            )}
            {error && <p className="err">{error}</p>}
            <button type="submit" className="solid" disabled={!ready || busy}>
              {busy ? "…" : mode === "register" ? "Створити акаунт" : "Увійти"}
            </button>
            <Link href={otherHref} className="switch">
              {otherLabel}
            </Link>
          </form>
        )}
      </div>
      <style jsx>{`
        .screen {
          min-height: calc(100vh - 3.2rem);
          display: flex;
          align-items: stretch;
          background:
            radial-gradient(900px 480px at 100% -10%, #e4ddd0 0%, transparent 55%),
            linear-gradient(165deg, #f7f3ec 0%, #ebe4d6 48%, #f3eee4 100%);
          font-family: "Segoe UI", "Candara", "Gill Sans", sans-serif;
          color: #1e2820;
        }
        .sheet {
          width: min(40rem, 100%);
          margin: 0 auto;
          padding: 2.5rem 1.25rem 4rem;
          display: flex;
          flex-direction: column;
          gap: 0.7rem;
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
          font-size: clamp(2.2rem, 5vw, 3.2rem);
          line-height: 1.05;
        }
        .lede {
          margin: 0 0 0.6rem;
          max-width: 36rem;
          font-size: 1.05rem;
          line-height: 1.45;
          color: #3d4a40;
        }
        form,
        .signed {
          display: grid;
          gap: 0.85rem;
          margin-top: 0.4rem;
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
        .solid,
        .ghost {
          font: inherit;
          font-size: 1rem;
          font-weight: 700;
          border-radius: 999px;
          padding: 0.75rem 1.1rem;
          cursor: pointer;
        }
        .solid {
          background: #2f4a3a;
          color: #f7f3ec;
          border: 1px solid #2f4a3a;
        }
        .ghost {
          background: transparent;
          color: #2f4a3a;
          border: 1px solid rgba(47, 74, 58, 0.35);
        }
        .solid:disabled {
          opacity: 0.55;
          cursor: default;
        }
        .err {
          margin: 0;
          color: #8a2b22;
        }
        .notice {
          margin: 0;
          color: #2f4a3a;
        }
        .rules {
          margin: -0.2rem 0 0;
          padding-left: 1.1rem;
          color: #5c6b60;
          font-size: 0.92rem;
        }
        .signed p {
          margin: 0;
          font-size: 1.05rem;
        }
        .signed span {
          color: #5c6b60;
        }
        .row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        :global(a.back),
        :global(a.switch) {
          color: #2f4a3a;
          font-weight: 700;
          text-decoration: none;
        }
        :global(a.switch) {
          justify-self: start;
        }
        :global(a.linkish) {
          display: inline-block;
          text-decoration: none;
          text-align: center;
        }
      `}</style>
    </section>
  );
}
