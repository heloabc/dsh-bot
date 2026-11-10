/**
 * Keep the union member that actually has `key`.
 * Runtime checks already expect that field; this makes the same check a type narrowing.
 */
export function field<T, K extends PropertyKey>(value: T, key: K): Extract<T, Record<K, unknown>> {
  if (value === null || typeof value !== 'object' || !(key in value)) {
    const message = value !== null && typeof value === 'object' && 'message' in value
      ? String(value.message)
      : ''
    throw new Error(`missing ${String(key)}${message === '' ? '' : `: ${message}`}`)
  }
  return value as Extract<T, Record<K, unknown>>
}
