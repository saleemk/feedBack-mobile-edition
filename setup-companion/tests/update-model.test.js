import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LATEST_STABLE_RELEASE_API_URL,
  buildCheckingUpdateModel,
  buildUpdateStatusModel,
  checkLatestStableRelease,
} from '../src/update-model.js';

const bundleIdentity = {
  status: 'ready',
  source: 'setup_bundle',
  localVersion: '0.3.0',
  localTag: 'v0.3.0',
  latestStableReleaseApiUrl: LATEST_STABLE_RELEASE_API_URL,
  reason: 'Installed setup bundle identity resolved.',
};

const developmentIdentity = {
  ...bundleIdentity,
  source: 'development_checkout',
  reason: 'Development checkout identity resolved.',
};

test('buildCheckingUpdateModel exposes a neutral checking state', () => {
  const model = buildCheckingUpdateModel();

  assert.equal(model.state, 'checking');
  assert.equal(model.label, 'Checking updates');
  assert.equal(model.latestVersion, '');
});

test('buildUpdateStatusModel reports current stable bundle and development checkout equality', () => {
  const latest = { tag_name: 'v0.3.0', prerelease: false, draft: false };

  const bundle = buildUpdateStatusModel(bundleIdentity, latest);
  assert.equal(bundle.state, 'current');
  assert.equal(bundle.label, 'Current stable bundle');
  assert.equal(bundle.localVersion, 'v0.3.0');
  assert.equal(bundle.latestVersion, 'v0.3.0');

  const development = buildUpdateStatusModel(developmentIdentity, latest);
  assert.equal(development.state, 'development_current');
  assert.equal(development.label, 'Development checkout');
  assert.match(development.summary, /matching the latest stable release/);
});

test('buildUpdateStatusModel compares numeric semantic versions', () => {
  const older = buildUpdateStatusModel(
    { ...bundleIdentity, localVersion: '0.3.9', localTag: 'v0.3.9' },
    { tag_name: 'v0.3.10', prerelease: false, draft: false },
  );
  assert.equal(older.state, 'available');
  assert.equal(older.latestVersion, 'v0.3.10');

  const newer = buildUpdateStatusModel(
    { ...bundleIdentity, localVersion: '0.10.0', localTag: 'v0.10.0' },
    { tag_name: 'v0.9.9', prerelease: false, draft: false },
  );
  assert.equal(newer.state, 'local_newer');
});

test('buildUpdateStatusModel treats malformed local identity and GitHub payloads neutrally', () => {
  assert.equal(buildUpdateStatusModel(null, null).state, 'unavailable');
  assert.equal(buildUpdateStatusModel({ ...bundleIdentity, status: 'unavailable', reason: 'bad metadata' }, null).label, "Couldn't check");
  assert.equal(buildUpdateStatusModel({ ...bundleIdentity, localVersion: '0.3' }, { tag_name: 'v0.3.0' }).state, 'unavailable');
  assert.equal(buildUpdateStatusModel({ ...bundleIdentity, latestStableReleaseApiUrl: 'https://example.com/latest' }, { tag_name: 'v0.3.0' }).state, 'unavailable');
  assert.equal(buildUpdateStatusModel(bundleIdentity, { tag_name: 'v0.3', prerelease: false }).state, 'unavailable');
  assert.equal(buildUpdateStatusModel(bundleIdentity, { tag_name: 'v0.3.0-rc.1', prerelease: true }).state, 'unavailable');
  assert.equal(buildUpdateStatusModel(bundleIdentity, { tag_name: 'v0.3.0', draft: true }).state, 'unavailable');
});

test('checkLatestStableRelease uses only the fixed endpoint and reports network failures neutrally', async () => {
  const calls = [];
  const current = await checkLatestStableRelease(bundleIdentity, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({ tag_name: 'v0.3.0', prerelease: false, draft: false }),
      };
    },
    timeoutMs: 50,
  });

  assert.equal(current.state, 'current');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, LATEST_STABLE_RELEASE_API_URL);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.credentials, 'omit');

  const failed = await checkLatestStableRelease(bundleIdentity, {
    fetchImpl: async () => {
      throw new Error('simulated network failure');
    },
  });
  assert.equal(failed.state, 'unavailable');
  assert.match(failed.summary, /simulated network failure/);

  const rateLimited = await checkLatestStableRelease(bundleIdentity, {
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) }),
  });
  assert.equal(rateLimited.state, 'unavailable');
  assert.match(rateLimited.summary, /403/);
});

test('checkLatestStableRelease reports timeout aborts neutrally', async () => {
  const timedOut = await checkLatestStableRelease(bundleIdentity, {
    timeoutMs: 1,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('simulated timeout abort')));
    }),
  });

  assert.equal(timedOut.state, 'unavailable');
  assert.match(timedOut.summary, /simulated timeout abort/);
});

test('checkLatestStableRelease does not fetch when local identity is unavailable', async () => {
  let fetched = false;
  const model = await checkLatestStableRelease(
    { status: 'unavailable', reason: 'metadata invalid' },
    {
      fetchImpl: async () => {
        fetched = true;
        throw new Error('should not fetch');
      },
    },
  );

  assert.equal(model.state, 'unavailable');
  assert.equal(fetched, false);
});
