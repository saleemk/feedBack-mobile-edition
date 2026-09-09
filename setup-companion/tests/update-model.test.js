import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LATEST_STABLE_RELEASE_API_URL,
  applySetupBundleActivationState,
  applySetupBundleVersionInventory,
  applySetupBundleUpdateState,
  buildCheckingUpdateModel,
  buildDefaultVersionActionModel,
  buildInstallSetupBundleUpdateActionModel,
  buildOpenInstalledSetupBundleUpdateActionModel,
  buildReviewUpdateActionModel,
  buildStageSetupBundleUpdateActionModel,
  buildUpdateStatusModel,
  ORIGINAL_SETUP_VERSION_VALUE,
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
  assert.equal(older.latestTag, 'v0.3.10');

  const newer = buildUpdateStatusModel(
    { ...bundleIdentity, localVersion: '0.10.0', localTag: 'v0.10.0' },
    { tag_name: 'v0.9.9', prerelease: false, draft: false },
  );
  assert.equal(newer.state, 'local_newer');
});

test('buildReviewUpdateActionModel appears only for a valid newer stable release', () => {
  const available = buildUpdateStatusModel(
    { ...bundleIdentity, localVersion: '0.3.0', localTag: 'v0.3.0' },
    { tag_name: 'v0.3.1', prerelease: false, draft: false },
  );

  const action = buildReviewUpdateActionModel(available);
  assert.equal(action.visible, true);
  assert.equal(action.canRun, true);
  assert.equal(action.tag, 'v0.3.1');
  assert.equal(action.label, 'Review update');
});

test('buildStageSetupBundleUpdateActionModel appears only for setup-bundle updates', () => {
  const setupBundleUpdate = buildUpdateStatusModel(
    { ...bundleIdentity, source: 'setup_bundle', localVersion: '0.3.0', localTag: 'v0.3.0' },
    { tag_name: 'v0.3.1', prerelease: false, draft: false },
  );
  const developmentUpdate = buildUpdateStatusModel(
    { ...developmentIdentity, source: 'development_checkout', localVersion: '0.3.0', localTag: 'v0.3.0' },
    { tag_name: 'v0.3.1', prerelease: false, draft: false },
  );

  const action = buildStageSetupBundleUpdateActionModel(setupBundleUpdate);
  assert.equal(action.visible, true);
  assert.equal(action.canRun, true);
  assert.equal(action.tag, 'v0.3.1');
  assert.equal(action.label, 'Download update');

  assert.equal(buildStageSetupBundleUpdateActionModel(developmentUpdate).visible, false);
  assert.equal(buildStageSetupBundleUpdateActionModel(buildCheckingUpdateModel()).visible, false);
  assert.equal(buildStageSetupBundleUpdateActionModel({ state: 'available', localSource: 'setup_bundle', latestTag: 'v0.3.1-rc.1' }).visible, false);
});

test('setup-bundle update state exposes install and open actions explicitly', () => {
  const available = buildUpdateStatusModel(
    { ...bundleIdentity, source: 'setup_bundle', localVersion: '0.3.0', localTag: 'v0.3.0' },
    { tag_name: 'v0.3.1', prerelease: false, draft: false },
  );
  const downloaded = applySetupBundleUpdateState(available, {
    status: 'downloaded',
    tag: 'v0.3.1',
    phase: 'downloaded',
    reason: 'Verified update ready to install.',
  });
  const installed = applySetupBundleUpdateState(available, {
    status: 'installed',
    tag: 'v0.3.1',
    phase: 'installed',
    reason: 'Update installed.',
  });

  assert.equal(downloaded.state, 'downloaded');
  assert.equal(downloaded.label, 'Update downloaded');
  assert.equal(buildStageSetupBundleUpdateActionModel(downloaded).visible, false);
  assert.equal(buildInstallSetupBundleUpdateActionModel(downloaded).visible, true);
  assert.equal(buildInstallSetupBundleUpdateActionModel(downloaded).label, 'Install update');
  assert.equal(buildOpenInstalledSetupBundleUpdateActionModel(downloaded).visible, false);

  assert.equal(installed.state, 'installed');
  assert.equal(installed.label, 'Update installed');
  assert.equal(installed.summary, 'Update installed. Try the new version when ready.');
  assert.equal(buildInstallSetupBundleUpdateActionModel(installed).visible, false);
  assert.equal(buildOpenInstalledSetupBundleUpdateActionModel(installed).visible, true);
  assert.equal(buildOpenInstalledSetupBundleUpdateActionModel(installed).label, 'Try new version');
  assert.equal(buildReviewUpdateActionModel(installed).visible, true);

  const developmentUpdate = buildUpdateStatusModel(
    { ...developmentIdentity, source: 'development_checkout', localVersion: '0.3.0', localTag: 'v0.3.0' },
    { tag_name: 'v0.3.1', prerelease: false, draft: false },
  );
  assert.equal(
    applySetupBundleUpdateState(developmentUpdate, { status: 'installed', tag: 'v0.3.1' }).state,
    'available',
  );
  assert.equal(buildInstallSetupBundleUpdateActionModel(developmentUpdate).visible, false);
  assert.equal(buildOpenInstalledSetupBundleUpdateActionModel(developmentUpdate).visible, false);
});

test('setup-bundle install conflict state is bounded and review-only', () => {
  const available = buildUpdateStatusModel(
    { ...bundleIdentity, source: 'setup_bundle', localVersion: '0.3.0', localTag: 'v0.3.0' },
    { tag_name: 'v0.3.1', prerelease: false, draft: false },
  );
  const conflict = applySetupBundleUpdateState(available, {
    status: 'conflict',
    tag: 'v0.3.1',
    phase: 'conflict',
    reason: 'C:\\Users\\person\\secret path should not leak',
  });

  assert.equal(conflict.state, 'install_conflict');
  assert.equal(conflict.label, 'Update install conflict');
  assert.doesNotMatch(conflict.summary, /secret|C:\\Users/);
  assert.equal(buildReviewUpdateActionModel(conflict).visible, true);
  assert.equal(buildStageSetupBundleUpdateActionModel(conflict).visible, false);
  assert.equal(buildInstallSetupBundleUpdateActionModel(conflict).visible, false);
  assert.equal(buildOpenInstalledSetupBundleUpdateActionModel(conflict).visible, false);
});

test('setup-bundle activation state uses clear next-launch language without default actions', () => {
  const currentBundle = buildUpdateStatusModel(
    { ...bundleIdentity, source: 'setup_bundle', localVersion: '0.3.1', localTag: 'v0.3.1' },
    { tag_name: 'v0.3.1', prerelease: false, draft: false },
  );
  const activatable = applySetupBundleActivationState(currentBundle, {
    status: 'activatable',
    tag: 'v0.3.1',
    reason: 'Make this version current for the original setup launcher.',
  });
  const invalidCurrent = applySetupBundleActivationState(currentBundle, {
    status: 'invalid_current',
    tag: 'v0.3.1',
    reason: 'C:\\Users\\person\\secret current record failed',
  });
  const current = applySetupBundleActivationState(currentBundle, {
    status: 'current',
    tag: 'v0.3.1',
    reason: 'The original setup launcher will open this version next time.',
  });

  assert.equal(activatable.state, 'activation_activatable');
  assert.equal(activatable.label, 'Setup version');
  assert.match(activatable.summary, /This window: v0\.3\.1/);
  assert.match(activatable.summary, /Choose the default for next time/);
  assert.equal(current.state, 'activation_current');
  assert.equal(current.label, 'Setup version');
  assert.equal(current.summary, 'This window: v0.3.1. Opens next time: v0.3.1.');
  assert.equal(invalidCurrent.state, 'activation_invalid_current');
  assert.equal(invalidCurrent.label, 'Needs selection');
  assert.doesNotMatch(invalidCurrent.summary, /secret|C:\\Users/);

  const developmentUpdate = buildUpdateStatusModel(
    { ...developmentIdentity, source: 'development_checkout', localVersion: '0.3.1', localTag: 'v0.3.1' },
    { tag_name: 'v0.3.1', prerelease: false, draft: false },
  );
  assert.equal(
    applySetupBundleActivationState(developmentUpdate, { status: 'activatable', tag: 'v0.3.1' }).state,
    'development_current',
  );
  assert.equal(
    applySetupBundleActivationState(currentBundle, { status: 'activatable', tag: 'v0.3.1/evil' }).state,
    'current',
  );
});

test('setup-bundle version inventory exposes one default-version action', () => {
  const currentBundle = buildUpdateStatusModel(
    { ...bundleIdentity, source: 'setup_bundle', localVersion: '0.3.1', localTag: 'v0.3.1' },
    { tag_name: 'v0.3.1', prerelease: false, draft: false },
  );
  const managed = applySetupBundleVersionInventory(currentBundle, {
    status: 'ready',
    versions: [{ tag: 'v0.4.0' }, { tag: 'v0.3.1' }, { tag: 'v0.2.0' }, { tag: 'bad' }],
    currentSource: 'managed',
    currentTag: 'v0.3.1',
    runningTag: 'v0.3.1',
    reason: 'path should not be displayed',
  });

  const managedDefault = buildDefaultVersionActionModel(managed);
  assert.equal(managed.label, 'Setup version');
  assert.equal(managed.summary, 'This window: v0.3.1. Opens next time: v0.3.1.');
  assert.deepEqual(managedDefault.options.map((option) => option.value), [
    ORIGINAL_SETUP_VERSION_VALUE,
    'v0.4.0',
    'v0.3.1',
    'v0.2.0',
  ]);
  assert.equal(managedDefault.selectedValue, 'v0.3.1');
  assert.equal(managedDefault.persistedValue, 'v0.3.1');
  assert.equal(managedDefault.canRun, false);
  assert.equal(buildDefaultVersionActionModel(managed, 'v0.3.1').canRun, false);
  assert.equal(buildDefaultVersionActionModel(managed, 'v0.4.0').canRun, true);
  assert.equal(buildDefaultVersionActionModel(managed, ORIGINAL_SETUP_VERSION_VALUE).canRun, true);

  const bundled = applySetupBundleVersionInventory(currentBundle, {
    status: 'ready',
    versions: [{ tag: 'v0.4.0' }],
    currentSource: 'bundled',
    currentTag: '',
    runningTag: 'v0.3.1',
    reason: 'bundled',
  });
  const bundledDefault = buildDefaultVersionActionModel(bundled);
  assert.equal(bundled.label, 'Setup version');
  assert.equal(bundled.summary, 'This window: v0.3.1. Opens next time: Original setup version.');
  assert.equal(bundledDefault.selectedValue, ORIGINAL_SETUP_VERSION_VALUE);
  assert.equal(bundledDefault.canRun, false);
  assert.equal(buildDefaultVersionActionModel(bundled, 'v0.4.0').canRun, true);

  const invalid = applySetupBundleVersionInventory(currentBundle, {
    status: 'ready',
    versions: [{ tag: 'v0.4.0' }],
    currentSource: 'invalid',
    currentTag: 'v9.9.9',
    runningTag: 'v0.3.1',
    reason: 'C:\\Users\\person\\secret',
  });
  const invalidDefault = buildDefaultVersionActionModel(invalid);
  assert.equal(invalid.label, 'Needs selection');
  assert.doesNotMatch(invalid.summary, /secret|C:\\Users/);
  assert.equal(invalidDefault.selectedValue, '');
  assert.equal(invalidDefault.canRun, false);
  assert.equal(buildDefaultVersionActionModel(invalid, ORIGINAL_SETUP_VERSION_VALUE).canRun, true);
  assert.equal(buildDefaultVersionActionModel(invalid, 'v0.4.0').canRun, true);

  const runningActivatable = applySetupBundleVersionInventory(
    applySetupBundleActivationState(currentBundle, {
      status: 'activatable',
      tag: 'v0.3.1',
      reason: 'Make this version current for the original setup launcher.',
    }),
    {
      status: 'ready',
      versions: [{ tag: 'v0.4.0' }, { tag: 'v0.3.1' }, { tag: 'v0.2.0' }],
      currentSource: 'bundled',
      currentTag: '',
      runningTag: 'v0.3.1',
      reason: 'bundled',
    },
  );
  const runningDefault = buildDefaultVersionActionModel(runningActivatable);
  assert.equal(runningDefault.selectedValue, ORIGINAL_SETUP_VERSION_VALUE);
  assert.deepEqual(runningDefault.options.map((option) => option.value), [
    ORIGINAL_SETUP_VERSION_VALUE,
    'v0.4.0',
    'v0.3.1',
    'v0.2.0',
  ]);
  assert.equal(buildDefaultVersionActionModel(runningActivatable, 'v0.3.1').canRun, true);
  assert.equal(buildDefaultVersionActionModel(runningActivatable, 'v0.4.0').canRun, true);

  const developmentUpdate = buildUpdateStatusModel(
    { ...developmentIdentity, source: 'development_checkout', localVersion: '0.3.1', localTag: 'v0.3.1' },
    { tag_name: 'v0.3.1', prerelease: false, draft: false },
  );
  assert.equal(
    applySetupBundleVersionInventory(developmentUpdate, { status: 'ready', versions: [{ tag: 'v0.4.0' }] }).state,
    'development_current',
  );
});

test('buildReviewUpdateActionModel hides every non-available update state', () => {
  const states = [
    buildCheckingUpdateModel(),
    buildUpdateStatusModel(bundleIdentity, { tag_name: 'v0.3.0', prerelease: false, draft: false }),
    buildUpdateStatusModel(developmentIdentity, { tag_name: 'v0.3.0', prerelease: false, draft: false }),
    buildUpdateStatusModel({ ...bundleIdentity, localVersion: '0.3.2', localTag: 'v0.3.2' }, { tag_name: 'v0.3.1', prerelease: false, draft: false }),
    buildUpdateStatusModel(bundleIdentity, { tag_name: 'v0.3.1-rc.1', prerelease: true, draft: false }),
    { state: 'available', latestTag: 'https://example.com/release', latestVersion: 'https://example.com/release' },
  ];

  for (const model of states) {
    const action = buildReviewUpdateActionModel(model);
    assert.equal(action.visible, false, model.state);
    assert.equal(action.canRun, false, model.state);
    assert.equal(action.tag, '', model.state);
  }
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
