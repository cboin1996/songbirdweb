// A shuffle order is the queue's indices in play order, so it is a permutation of
// 0..length-1. The queue panel indexes the queue with each entry; one that is not
// a permutation (an index past the end, a duplicate) leaves a hole in the list
// and takes the panel down on open. Saved state is trusted from the server and
// from other devices, so it is checked before use rather than assumed.
export function isValidShuffleOrder(order: unknown, queueLength: number): order is number[] {
  if (!Array.isArray(order) || order.length !== queueLength) return false
  const seen = new Set<number>()
  for (const index of order) {
    if (!Number.isInteger(index) || index < 0 || index >= queueLength || seen.has(index)) return false
    seen.add(index)
  }
  return true
}
