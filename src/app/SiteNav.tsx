"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { COMPARE_STORES } from "@/domain/compare-stores";
import { useCompareStores } from "./CompareStoresContext";

const LINKS = [
  { href: "/", label: "Cafe staples" },
  { href: "/dev/match-inspector", label: "Match inspector" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteNav() {
  const pathname = usePathname() || "/";
  const { isOn, toggle, count } = useCompareStores();
  const showStorePicker = pathname === "/";

  return (
    <nav className="site-nav" aria-label="Site">
      <div className="inner">
        <Link href="/" className="mark">
          Royal SASS
        </Link>
        <div className="links">
          {LINKS.map((link) => {
            const on = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={on ? "tab on" : "tab"}
                aria-current={on ? "page" : undefined}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
      {showStorePicker && (
        <div className="store-picker" role="group" aria-label="Магазини для порівняння">
          <span className="picker-label">Порівнювати</span>
          {COMPARE_STORES.map((store) => {
            const on = isOn(store.id);
            const lastOn = on && count <= 1;
            return (
              <button
                key={store.id}
                type="button"
                className={on ? "store-btn on" : "store-btn"}
                aria-pressed={on}
                title={
                  lastOn
                    ? `${store.label} ${store.detail} — залиш хоча б один магазин`
                    : `${store.label} ${store.detail}`
                }
                onClick={() => toggle(store.id)}
              >
                <span className="store-short">{store.short}</span>
                <span className="store-long">
                  {store.label} {store.detail}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <style jsx>{`
        .site-nav {
          position: sticky;
          top: 0;
          z-index: 40;
          background: rgba(247, 243, 236, 0.94);
          border-bottom: 1px solid rgba(30, 40, 30, 0.12);
          backdrop-filter: blur(10px);
          font-family: "Segoe UI", "Candara", "Gill Sans", sans-serif;
        }
        .inner {
          max-width: 1180px;
          margin: 0 auto;
          padding: 0.55rem 1rem 0.4rem;
          display: flex;
          flex-wrap: wrap;
          gap: 0.65rem 1rem;
          align-items: center;
        }
        .links {
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
        }
        .store-picker {
          max-width: 1180px;
          margin: 0 auto;
          padding: 0 1rem 0.55rem;
          display: flex;
          flex-wrap: wrap;
          gap: 0.35rem;
          align-items: center;
        }
        .picker-label {
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #2f4a3a;
          margin-right: 0.2rem;
        }
        .store-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          border: 1px solid rgba(47, 74, 58, 0.28);
          background: transparent;
          color: #3d4a40;
          font: inherit;
          font-size: 0.82rem;
          font-weight: 650;
          padding: 0.32rem 0.7rem;
          border-radius: 999px;
          cursor: pointer;
        }
        .store-btn:hover {
          background: rgba(47, 74, 58, 0.08);
        }
        .store-btn.on {
          background: #2f4a3a;
          color: #f7f3ec;
          border-color: #2f4a3a;
        }
        .store-short {
          font-variant: all-small-caps;
          letter-spacing: 0.04em;
        }
        .store-long {
          opacity: 0.92;
        }
        @media (max-width: 720px) {
          .store-long {
            display: none;
          }
        }
        :global(.site-nav a.mark) {
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          font-size: 0.72rem;
          color: #2f4a3a;
          text-decoration: none;
        }
        :global(.site-nav a.tab) {
          display: inline-block;
          text-decoration: none;
          color: #3d4a40;
          font-size: 0.92rem;
          font-weight: 600;
          padding: 0.38rem 0.7rem;
          border-radius: 999px;
          border: 1px solid transparent;
        }
        :global(.site-nav a.tab:hover) {
          background: rgba(47, 74, 58, 0.08);
        }
        :global(.site-nav a.tab.on) {
          background: #2f4a3a;
          color: #f7f3ec;
          border-color: #2f4a3a;
        }
      `}</style>
    </nav>
  );
}
