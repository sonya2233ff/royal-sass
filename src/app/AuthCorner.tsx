"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  fetchSession,
  logoutAccount,
  type AccountPublic,
} from "@/lib/account-auth";

export function AuthCorner() {
  const pathname = usePathname() || "/";
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<AccountPublic | null>(null);

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
  }, [pathname]);

  function logout() {
    void logoutAccount().then(() => setAccount(null));
  }

  return (
    <div className="auth">
      {account ? (
        <div className="who">
          <Link href="/login" className="name" title={account.email}>
            {account.name}
          </Link>
          <button type="button" className="ghost" onClick={logout}>
            Вийти
          </button>
        </div>
      ) : (
        <div className="who">
          <Link
            href="/login"
            className={pathname === "/login" ? "ghost on" : "ghost"}
            aria-disabled={!ready}
          >
            Увійти
          </Link>
          <Link
            href="/register"
            className={pathname === "/register" ? "solid on" : "solid"}
          >
            Реєстрація
          </Link>
        </div>
      )}
      <style jsx>{`
        .auth {
          margin-left: auto;
          display: flex;
          align-items: center;
        }
        .who {
          display: flex;
          align-items: center;
          gap: 0.35rem;
        }
        :global(a.name) {
          max-width: 9rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 0.88rem;
          font-weight: 700;
          color: #2f4a3a;
          text-decoration: none;
        }
        :global(a.ghost),
        :global(a.solid) {
          font-size: 0.86rem;
          font-weight: 650;
          border-radius: 999px;
          padding: 0.32rem 0.75rem;
          text-decoration: none;
        }
        :global(a.ghost) {
          background: transparent;
          color: #2f4a3a;
          border: 1px solid rgba(47, 74, 58, 0.35);
        }
        :global(a.solid) {
          background: #2f4a3a;
          color: #f7f3ec;
          border: 1px solid #2f4a3a;
        }
        .ghost {
          font: inherit;
          font-size: 0.86rem;
          font-weight: 650;
          border-radius: 999px;
          padding: 0.32rem 0.75rem;
          cursor: pointer;
          background: transparent;
          color: #2f4a3a;
          border: 1px solid rgba(47, 74, 58, 0.35);
        }
      `}</style>
    </div>
  );
}
