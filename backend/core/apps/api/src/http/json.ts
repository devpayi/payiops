import { createHash } from 'node:crypto';
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export function object(value: unknown): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected JSON object');
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}
export function text(value: unknown, field: string, maxLength = 512): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) throw new Error(`Invalid ${field}`);
  return value;
}
export function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key] ?? null)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export function sha256(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
