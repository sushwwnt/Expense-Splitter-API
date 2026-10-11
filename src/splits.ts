export type SplitType = 'EQUAL' | 'EXACT' | 'PERCENT';

export interface SplitInput {
  user_id: number;
  value?: number; 
}

export interface PayerInput {
  user_id: number;
  amount: number; 
}

export interface Share {
  user_id: number;
  amount: number;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export const toPaise = (rupees: number) => Math.round(rupees * 100);
export const toRupees = (paise: number | string) => Number(paise) / 100;

const fmt = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
const fail = <T>(error: string): Result<T> => ({ ok: false, error });
const ok = <T>(data: T): Result<T> => ({ ok: true, data });

// Checks that the people who paid add up to exactly the expense total.
export function validatePayers(totalPaise: number, payers: PayerInput[]): Result<Share[]> {
  const ids = new Set(payers.map(p => p.user_id));
  if (ids.size !== payers.length) {
    return fail('Each payer can only be listed once');
  }

  const shares = payers.map(p => ({ user_id: p.user_id, amount: toPaise(p.amount) }));
  if (shares.some(s => s.amount <= 0)) {
    return fail('Each payer amount must be greater than zero');
  }

  const sum = shares.reduce((total, s) => total + s.amount, 0);
  if (sum !== totalPaise) {
    return fail(`Payer amounts add up to ${fmt(sum)} but the expense total is ${fmt(totalPaise)}`);
  }

  return ok(shares);
}

// Turns the split request into the exact paise each person owes.
// The returned shares always add up to totalPaise.
export function computeShares(type: SplitType, totalPaise: number, inputs: SplitInput[]): Result<Share[]> {
  if (inputs.length === 0) {
    return fail('Choose at least one person to split with');
  }

  const ids = new Set(inputs.map(i => i.user_id));
  if (ids.size !== inputs.length) {
    return fail('Each person can only appear once in the split');
  }

  const sorted = [...inputs].sort((a, b) => a.user_id - b.user_id);

  if (type === 'EQUAL') {
    // 100.00 between 3 people gives 33.34, 33.33, 33.33 so no paisa is lost
    const base = Math.floor(totalPaise / sorted.length);
    const extra = totalPaise - base * sorted.length;
    return ok(sorted.map((s, index) => ({ user_id: s.user_id, amount: base + (index < extra ? 1 : 0) })));
  }

  if (sorted.some(s => s.value === undefined || s.value <= 0)) {
    return fail('Enter a value greater than zero for everyone in the split');
  }

  if (type === 'EXACT') {
    const shares = sorted.map(s => ({ user_id: s.user_id, amount: toPaise(s.value as number) }));
    const sum = shares.reduce((total, s) => total + s.amount, 0);
    if (sum !== totalPaise) {
      return fail(`Split amounts add up to ${fmt(sum)} but the expense total is ${fmt(totalPaise)}`);
    }
    return ok(shares);
  }

  // PERCENT: work in basis points (1% = 100) so the sum check is exact
  const basisPoints = sorted.map(s => Math.round((s.value as number) * 100));
  const bpSum = basisPoints.reduce((total, bp) => total + bp, 0);
  if (bpSum !== 10000) {
    return fail(`Percentages add up to ${(bpSum / 100).toFixed(2)}% but must add up to 100%`);
  }

  const parts = sorted.map((s, index) => {
    const numerator = totalPaise * basisPoints[index];
    return {
      user_id: s.user_id,
      amount: Math.floor(numerator / 10000),
      remainder: numerator % 10000,
    };
  });

  // Hand the leftover paise to the people with the biggest fractional remainder
  let leftover = totalPaise - parts.reduce((total, p) => total + p.amount, 0);
  const byRemainder = [...parts].sort((a, b) => b.remainder - a.remainder || a.user_id - b.user_id);
  for (const part of byRemainder) {
    if (leftover <= 0) break;
    part.amount += 1;
    leftover -= 1;
  }

  return ok(parts.map(({ user_id, amount }) => ({ user_id, amount })));
}