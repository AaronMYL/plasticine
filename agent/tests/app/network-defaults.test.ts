import assert from 'node:assert/strict';
import { getDefaultAutoSelectFamilyAttemptTimeout, setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { test } from 'node:test';
import { AUTO_SELECT_FAMILY_TIMEOUT_MS, configureNetworkDefaults } from '../../src/app/network-defaults.ts';

test('Raises low Happy Eyeballs timeout and preserves a higher configured value', () => {
  const original = getDefaultAutoSelectFamilyAttemptTimeout();
  try {
    setDefaultAutoSelectFamilyAttemptTimeout(250);
    configureNetworkDefaults();
    assert.equal(getDefaultAutoSelectFamilyAttemptTimeout(), AUTO_SELECT_FAMILY_TIMEOUT_MS);

    setDefaultAutoSelectFamilyAttemptTimeout(8_000);
    configureNetworkDefaults();
    assert.equal(getDefaultAutoSelectFamilyAttemptTimeout(), 8_000);
  } finally {
    setDefaultAutoSelectFamilyAttemptTimeout(original);
  }
});
