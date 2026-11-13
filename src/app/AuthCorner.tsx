"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fetchSession, logoutAccount, type AccountPublic } from "@/lib/account-auth";

export function AuthCorner() {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [account, setAccount] = useState<AccountPublic | null>(null);
  const [open, setOpen] = useState(false);

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

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function logout() {
    setOpen(false);
    void logoutAccount().then(() => {
      setAccount(null);
      router.push("/");
    });
  }

  return (
    <div className="auth" ref={menuRef}>
      {account ? (
        <div className="who">
          <button
            type="button"
            className="name"
            aria-expanded={open}
            aria-haspopup="menu"
            title={account.email}
            onClick={() => setOpen((value) => !value)}
          >
            {account.name}
          </button>
          {open && (
            <div className="menu" role="menu">
              <Link href="/profile" role="menuitem" onClick={() => setOpen(false)}>
                Профіль
              </Link>
              <Link href="/settings" role="menuitem" onClick={() => setOpen(false)}>
                Налаштування
              </Link>
              <button type="button" role="menuitem" onClick={logout}>
                Вийти
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="who">
          <Link href="/login" className={pathname === "/login" ? "ghost on" : "ghost"} aria-disabled={!ready}>
            Увійти
          </Link>
          <Link href="/register" className={pathname === "/register" ? "solid on" : "solid"}>
            Реєстрація
          </Link>
        </div>
      )}
      <style jsx>{`
        .auth {
          margin-left: auto;
          display: flex;
          align-items: center;
          position: relative;
        }
        .who {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          position: relative;
        }
        .name {
          max-width: 9rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font: inherit;
          font-size: 0.88rem;
          font-weight: 700;
          color: #2f4a3a;
          background: transparent;
          border: 0;
          cursor: pointer;
          padding: 0.32rem 0.2rem;
        }
        .menu {
          position: absolute;
          top: calc(100% + 0.35rem);
          right: 0;
          z-index: 50;
          min-width: 11rem;
          display: grid;
          background: #fffdf8;
          border: 1px solid rgba(47, 74, 58, 0.18);
          border-radius: 12px;
          padding: 0.35rem;
          box-shadow: 0 10px 30px rgba(30, 40, 30, 0.12);
        }
        .menu :global(a),
        .menu button {
          font: inherit;
          text-align: left;
          text-decoration: none;
          color: #1e2820;
          background: transparent;
          border: 0;
          border-radius: 8px;
          padding: 0.55rem 0.7rem;
          cursor: pointer;
          font-weight: 650;
        }
        .menu :global(a:hover),
        .menu button:hover {
          background: #f3eee4;
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
      `}</style>
    </div>
  );
}
