/** Type guard for plain (non-array) objects, used to decide whether to recurse during a deep merge. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recursively merges `source` into `target` without mutating either input.
 * Mirrors the "deep merge" semantics AUTH-PRO documents for PATCH /users/me metadata.
 */
export function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result: Record<string, unknown> = { ...target };

  for (const [key, value] of Object.entries(source)) {
    const existing = result[key];
    result[key] = isPlainObject(value) && isPlainObject(existing) ? deepMerge(existing, value) : value;
  }

  return result as T;
}

/** Standard success envelope returned by every gateway endpoint, for a consistent client contract. */
export function toResponseEnvelope<T>(data: T) {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  };
}
