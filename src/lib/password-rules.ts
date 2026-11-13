/** Signup password rules. Login does not re-check these, so older accounts still sign in. */
export function passwordRuleError(password: string): string | null {
  if (password.length < 6) return "Пароль — щонайменше 6 символів.";
  if (!/^\p{Lu}/u.test(password)) {
    return "Пароль має починатися з великої літери.";
  }
  if (!/\p{L}/u.test(password)) {
    return "Пароль має містити хоча б одну літеру.";
  }
  if (!/[^\p{L}\p{N}]/u.test(password)) {
    return "Пароль має містити хоча б один спеціальний символ.";
  }
  return null;
}
