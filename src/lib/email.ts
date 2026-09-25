// Must stay equivalent to lower(btrim(email)), which users_email_normalized_check
// enforces in the database.
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
