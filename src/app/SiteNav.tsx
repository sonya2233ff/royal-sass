"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
          padding: 0.55rem 1rem;
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
