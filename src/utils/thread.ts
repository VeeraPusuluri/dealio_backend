// Private per-deal chat threads are identified by the canonical (alphabetically
// sorted) pair of the two participating roles. With roles ordered
// builder < cp < customer the only valid keys are:
//   "builder-cp" | "builder-customer" | "cp-customer"
// Only the two named roles may read or write a thread.

export type ChatRole = 'builder' | 'cp' | 'customer';

export const CANONICAL_THREAD_KEYS = new Set([
  'builder-cp',
  'builder-customer',
  'cp-customer',
]);

/** Canonical threadKey for the conversation between two distinct roles. */
export function threadKey(a: ChatRole, b: ChatRole): string {
  return [a, b].sort().join('-');
}

/** The two roles that participate in a threadKey, or null if it is malformed. */
export function rolesOfThread(key: string): [ChatRole, ChatRole] | null {
  if (!CANONICAL_THREAD_KEYS.has(key)) return null;
  const [a, b] = key.split('-') as [ChatRole, ChatRole];
  return [a, b];
}

/** True when `role` is one of the two participants of `key`. */
export function roleInThread(role: string, key: string): boolean {
  const roles = rolesOfThread(key);
  return !!roles && (roles[0] === role || roles[1] === role);
}
