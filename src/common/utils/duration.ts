// Parses a jsonwebtoken-style duration string ("15m", "7d", "1h", "30s") to
// milliseconds — just enough to compute RefreshToken.expiresAt alongside a JWT signed
// with the same string.
const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDurationMs(duration: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(duration.trim());
  if (!match) {
    throw new Error(`Unsupported duration format: "${duration}" (expected e.g. "15m", "7d")`);
  }
  const [, amount, unit] = match;
  return Number(amount) * UNIT_MS[unit as string]!;
}
