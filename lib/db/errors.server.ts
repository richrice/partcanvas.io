// Walks the error cause chain looking for a Postgres unique violation
// (SQLSTATE 23505) from either the pg driver or PGlite.
export function isUniqueViolation(error: unknown): boolean {
  for (let current = error; current; current = (current as { cause?: unknown }).cause) {
    if ((current as { code?: string }).code === "23505") return true;
    if (current instanceof Error && /duplicate key value/.test(current.message)) return true;
  }
  return false;
}
