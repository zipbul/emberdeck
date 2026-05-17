export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    const s = JSON.stringify(e);
    if (s !== undefined) return s;
  } catch {
    // fall through
  }
  return String(e);
}
