/** Public customer fields returned by the auth API. Password never leaves the server. */
export type AccountPublic = {
  id: string;
  name: string;
  email: string;
};

type AuthResult =
  | { ok: true; customer: AccountPublic }
  | { ok: false; error: string };

export type RegisterResult =
  | { ok: true; pending: true; email: string }
  | { ok: false; error: string };

async function postJson(path: string, body: unknown): Promise<{
  ok?: boolean;
  error?: string;
  customer?: AccountPublic;
  pending?: boolean;
  email?: string;
}> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    customer?: AccountPublic;
    pending?: boolean;
    email?: string;
  };
}

async function postAuth(path: string, body: unknown): Promise<AuthResult> {
  const data = await postJson(path, body);
  if (!data.ok || !data.customer) {
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

export async function registerAccount(input: {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  workplace: unknown;
}): Promise<RegisterResult> {
  const data = await postJson("/api/auth/register", input);
  if (!data.ok || !data.pending || !data.email) {
    return { ok: false, error: data.error ?? "Не вдалося надіслати код." };
  }
  return { ok: true, pending: true, email: data.email };
}

export function verifySignupCode(input: {
  email: string;
  code: string;
}): Promise<AuthResult> {
  return postAuth("/api/auth/verify", input);
}

export async function resendSignupCode(
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const data = await postJson("/api/auth/resend", { email });
  if (!data.ok) return { ok: false, error: data.error ?? "Не вдалося надіслати код." };
  return { ok: true };
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
