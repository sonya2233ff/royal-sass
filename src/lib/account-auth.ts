/**
 * Browser accounts for the corner login. Live store is localStorage
 * (same pattern as product overrides on Vercel). Passwords are salted SHA-256,
 * never kept in the session.
 */

export type AccountPublic = {
  id: string;
  name: string;
  email: string;
};

export type StoredAccount = AccountPublic & {
  salt: string;
  passwordHash: string;
};

export type AccountStore = {
  accounts: StoredAccount[];
  session: AccountPublic | null;
};

export const ACCOUNTS_STORAGE_KEY = "royal-sass-accounts-v1";
export const SESSION_STORAGE_KEY = "royal-sass-session-v1";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function newSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return hex(bytes.buffer);
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return hex(digest);
}

function publicOf(account: StoredAccount): AccountPublic {
  return { id: account.id, name: account.name, email: account.email };
}

export async function registerInto(
  store: AccountStore,
  input: { name: string; email: string; password: string },
): Promise<{ ok: true; account: AccountPublic; store: AccountStore } | { ok: false; error: string }> {
  const name = input.name.trim().slice(0, 40);
  const email = normalizeEmail(input.email);
  const password = input.password;
  if (name.length < 1) return { ok: false, error: "Вкажи ім'я." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Вкажи справжній email." };
  if (password.length < 6) return { ok: false, error: "Пароль — щонайменше 6 символів." };
  if (store.accounts.some((a) => a.email === email)) {
    return { ok: false, error: "Такий email уже є. Увійди." };
  }
  const salt = newSalt();
  const passwordHash = await hashPassword(password, salt);
  const account: StoredAccount = {
    id: crypto.randomUUID(),
    name,
    email,
    salt,
    passwordHash,
  };
  const next: AccountStore = {
    accounts: [...store.accounts, account],
    session: publicOf(account),
  };
  return { ok: true, account: publicOf(account), store: next };
}

export async function loginInto(
  store: AccountStore,
  input: { email: string; password: string },
): Promise<{ ok: true; account: AccountPublic; store: AccountStore } | { ok: false; error: string }> {
  const email = normalizeEmail(input.email);
  const hit = store.accounts.find((a) => a.email === email);
  if (!hit) return { ok: false, error: "Невірний email або пароль." };
  const passwordHash = await hashPassword(input.password, hit.salt);
  if (passwordHash !== hit.passwordHash) {
    return { ok: false, error: "Невірний email або пароль." };
  }
  const account = publicOf(hit);
  return { ok: true, account, store: { ...store, session: account } };
}

export function logoutStore(store: AccountStore): AccountStore {
  return { ...store, session: null };
}

function readJson(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function isStoredAccount(row: unknown): row is StoredAccount {
  if (!row || typeof row !== "object") return false;
  const rec = row as Record<string, unknown>;
  return (
    typeof rec.id === "string" &&
    typeof rec.name === "string" &&
    typeof rec.email === "string" &&
    typeof rec.salt === "string" &&
    typeof rec.passwordHash === "string"
  );
}

export function loadAccountStore(): AccountStore {
  const accountsRaw = readJson(ACCOUNTS_STORAGE_KEY);
  const accounts = Array.isArray(accountsRaw)
    ? accountsRaw.filter(isStoredAccount)
    : [];
  const sessionRaw = readJson(SESSION_STORAGE_KEY);
  const session =
    sessionRaw &&
    typeof sessionRaw === "object" &&
    typeof (sessionRaw as AccountPublic).id === "string" &&
    typeof (sessionRaw as AccountPublic).email === "string" &&
    typeof (sessionRaw as AccountPublic).name === "string"
      ? {
          id: (sessionRaw as AccountPublic).id,
          name: (sessionRaw as AccountPublic).name,
          email: (sessionRaw as AccountPublic).email,
        }
      : null;
  const live = session && accounts.some((a) => a.id === session.id) ? session : null;
  return { accounts, session: live };
}

export function writeAccountStore(store: AccountStore): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(store.accounts));
  if (store.session) {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(store.session));
  } else {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }
}
