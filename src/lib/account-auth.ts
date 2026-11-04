/** Public customer fields returned by the auth API. Password never leaves the server. */
export type AccountPublic = {
  id: string;
  name: string;
  email: string;
};

type AuthResult =
  | { ok: true; customer: AccountPublic }
  | { ok: false; error: string };

async function postAuth(path: string, body: unknown): Promise<AuthResult> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    customer?: AccountPublic;
  };
  if (!res.ok || !data.ok || !data.customer) {
    return { ok: false, error: data.error ?? "Не вдалося зберегти акаунт." };
  }
  return { ok: true, customer: data.customer };
}

export function fetchSession(): Promise<AccountPublic | null> {
  return fetch("/api/auth/session")
    .then(async (res) => {
      const data = (await res.json().catch(() => ({}))) as {
        customer?: AccountPublic | null;
      };
      return data.customer ?? null;
    })
    .catch(() => null);
}

export function registerAccount(input: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthResult> {
  return postAuth("/api/auth/register", input);
}

export function loginAccount(input: {
  email: string;
  password: string;
}): Promise<AuthResult> {
  return postAuth("/api/auth/login", input);
}

export function logoutAccount(): Promise<void> {
  return fetch("/api/auth/logout", { method: "POST" }).then(() => undefined);
}
