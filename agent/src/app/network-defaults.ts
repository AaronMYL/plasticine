import { getDefaultAutoSelectFamilyAttemptTimeout, setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';

export const AUTO_SELECT_FAMILY_TIMEOUT_MS = 5_000;

/**
 * Raise Node's Happy Eyeballs per-family attempt timeout so dual-stack
 * endpoints over high-latency cross-border links do not abort at 250 ms.
 */
export function configureNetworkDefaults(minimumMs: number = AUTO_SELECT_FAMILY_TIMEOUT_MS): void {
  if (getDefaultAutoSelectFamilyAttemptTimeout() < minimumMs) {
    setDefaultAutoSelectFamilyAttemptTimeout(minimumMs);
  }
}
