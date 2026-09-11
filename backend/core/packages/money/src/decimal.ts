import { Decimal as DecimalBase } from 'decimal.js';
export const Decimal = DecimalBase.clone({ precision: 60, rounding: DecimalBase.ROUND_HALF_UP });
export type MoneyDecimal = DecimalBase;
export function decimal(value: string): MoneyDecimal {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) throw new Error('A finite decimal string is required');
  return new Decimal(value);
}
export function money(value: MoneyDecimal): string { return value.toDecimalPlaces(2).toFixed(2); }

/** Divide integer satang, distributing the remainder by stable order rank. */
export function allocate(total: string, rank: string, count: string): string {
  const amount = decimal(total);
  const n = BigInt(count); const position = BigInt(rank);
  if (n < 1n || position < 1n || position > n) throw new Error('Invalid allocation population');
  if (amount.decimalPlaces() > 2) throw new Error('Allocation total must already be rounded to satang');
  const units = BigInt(amount.abs().times(100).toFixed(0));
  const share = units/n + (position <= units%n ? 1n : 0n);
  return money(new Decimal(share.toString()).div(100).times(amount.isNegative() ? -1 : 1));
}
