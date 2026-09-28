// Typing a password wrong is ordinary, so the first failures cost nothing.
// Only a run of them looks like a machine and starts buying time.
export const THROTTLE_FREE_ATTEMPTS = 3;
export const THROTTLE_BASE_BLOCK_SECONDS = 60;
export const THROTTLE_BLOCK_MULTIPLIER = 5;
export const THROTTLE_MAX_BLOCK_SECONDS = 60 * 60;

export function blockSecondsForFailures(failedCount: number): number {
  if (failedCount <= THROTTLE_FREE_ATTEMPTS) {
    return 0;
  }
  const steps = failedCount - THROTTLE_FREE_ATTEMPTS - 1;
  const seconds =
    THROTTLE_BASE_BLOCK_SECONDS * THROTTLE_BLOCK_MULTIPLIER ** steps;
  return Math.min(seconds, THROTTLE_MAX_BLOCK_SECONDS);
}

// Derived rather than stored: the block follows from how many failures there
// were and when the last one happened, so persisting it would only add a
// column that can disagree with the other two.
export function blockedUntil(
  failedCount: number,
  lastFailedAt: Date,
): Date | null {
  const seconds = blockSecondsForFailures(failedCount);
  return seconds > 0 ? new Date(lastFailedAt.getTime() + seconds * 1000) : null;
}
