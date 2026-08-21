import type { Prisma, PrismaClient } from "@prisma/client";

// Accepts either the base client or a transaction client, so callers can (and should)
// pull the next code inside the same $transaction as the entity create — a rolled-back
// create then rolls back the increment too, keeping the sequence gap-free.
type PrismaLike = PrismaClient | Prisma.TransactionClient;

// Human-readable code format per entity type: `${prefix}${zero-padded number}`.
const CODE_CONFIG = {
  STUDENT: { prefix: "S", pad: 4 },
  COUNSELLOR: { prefix: "C", pad: 4 },
  PROJECT: { prefix: "P", pad: 4 },
} as const;

export type CodeSequenceKey = keyof typeof CODE_CONFIG;

// Returns the next code for `key`, e.g. "S0001". The `update ... increment` is a single
// atomic, row-locked write; the counter rows are seeded by the migration so the create
// branch of the upsert only ever runs if a row is somehow missing. Padding is a minimum —
// the number keeps growing past the pad width (e.g. "S10000") once the count exceeds it.
export async function nextCode(tx: PrismaLike, key: CodeSequenceKey): Promise<string> {
  const { prefix, pad } = CODE_CONFIG[key];
  const row = await tx.codeSequence.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `${prefix}${String(row.value).padStart(pad, "0")}`;
}
