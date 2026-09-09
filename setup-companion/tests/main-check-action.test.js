import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createClassList(element) {
  return {
    add(name) {
      const names = new Set(element.className.split(/\s+/).filter(Boolean));
      names.add(name);
      element.className = [...names].join(' ');
    },
    remove(name) {
      const names = new Set(element.className.split(/\s+/).filter(Boolean));
      names.delete(name);
      element.className = [...names].join(' ');
    },
    toggle(name, force) {
      const shouldAdd = force ?? !element.className.split(/\s+/).includes(name);
      if (shouldAdd) {
        this.add(name);
      } else {
        this.remove(name);
      }
      return shouldAdd;
    },
  };
}

class FakeElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.attributes = new Map();
    this.children = [];
    this.className = '';
    this.dataset = {};
    this.disabled = false;
    this.hidden = false;
    this.textContent = '';
    this.value = '';
    this.listeners = new Map();
    this.classList = createClassList(this);
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  click() {
    if (this.disabled) return;
    for (const handler of this.listeners.get('click') || []) {
      handler({ currentTarget: this, target: this });
    }
  }

  change(value) {
    if (this.disabled) return;
    this.value = value;
    for (const handler of this.listeners.get('change') || []) {
      handler({ currentTarget: this, target: this });
    }
  }
}

function createDocument() {
  const ids = [
    'refresh',
    'status-band',
    'overall-label',
    'overall-reason',
    'check-action-row',
    'check-action',
    'check-action-message',
    'update-status',
    'update-heading',
    'update-summary',
    'update-versions',
    'review-update',
    'download-update',
    'install-update',
    'open-update',
    'default-version-field',
    'default-version-select',
    'save-default-version',
    'update-progress',
    'generated-at',
    'checks-list',
    'check-view',
    'library-view',
    'server-view',
    'devices-view',
    'footer-mode',
    'library-badge',
    'current-library',
    'selected-library',
    'library-message',
    'browse-library',
    'apply-library',
    'server-badge',
    'server-summary-text',
    'server-checks-list',
    'server-message',
    'server-action',
    'server-progress',
    'server-progress-title',
    'server-progress-elapsed',
    'devices-badge',
    'devices-summary-text',
    'devices-url',
    'devices-checks-list',
    'devices-message',
    'devices-action',
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement('div', id)]));
  for (const id of ['refresh', 'check-action', 'review-update', 'download-update', 'install-update', 'open-update', 'save-default-version', 'browse-library', 'apply-library', 'server-action', 'devices-action']) {
    elements.get(id).tagName = 'BUTTON';
  }
  elements.get('default-version-field').tagName = 'LABEL';
  elements.get('default-version-select').tagName = 'SELECT';
  for (const id of ['library-view', 'server-view', 'devices-view', 'check-action-row', 'server-progress']) {
    elements.get(id).hidden = true;
  }

  const viewButtons = ['check', 'library', 'server', 'devices'].map((view) => {
    const button = new FakeElement('button');
    button.dataset.view = view;
    return button;
  });

  return {
    elements,
    viewButtons,
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    querySelector(selector) {
      if (selector.startsWith('#')) return elements.get(selector.slice(1)) || null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-view]') return viewButtons;
      return [];
    },
  };
}

async function importMainWithHarness({
  statusPayload,
  deviceResult,
  serverResult,
  libraryFolder = 'C:\\Music',
  libraryValidation = { valid: true, path: 'C:\\Music', reason: 'Library folder is usable.' },
  libraryResult = { valid: true, path: 'C:\\Music', reason: 'Library saved.' },
  updateIdentity = { status: 'unavailable', reason: 'Update identity check disabled in this test.' },
  latestRelease = { tag_name: 'v0.3.0', prerelease: false, draft: false },
  updateReviewResult,
  updateStageResult,
  updateInstallState,
  updateInstallResult,
  updateOpenResult,
  updateActivationState,
  updateActivationResult,
  versionInventory,
  versionSelectResult,
  versionRestoreResult,
  fetchImpl,
  getStatus,
}) {
  const document = createDocument();
  const calls = [];
  const eventListeners = new Map();
  const emitTauriEvent = (name, payload) => {
    for (const listener of eventListeners.get(name) || []) listener({ payload });
  };
  const invoke = async (command, args = {}) => {
    calls.push({ command, args });
    if (command === 'get_setup_status') {
      const result = getStatus ? await getStatus(args) : statusPayload;
      return clone(result);
    }
    if (command === 'get_update_identity') return clone(updateIdentity);
    if (command === 'review_available_update') return typeof updateReviewResult === 'function'
      ? updateReviewResult(args)
      : clone(updateReviewResult || {
        status: 'opened',
        tag: args.tag,
        reason: `Opened the ${args.tag} Mobile Edition release page.`,
      });
    if (command === 'stage_setup_bundle_update') return typeof updateStageResult === 'function'
      ? updateStageResult(args, emitTauriEvent)
      : clone(updateStageResult || {
        status: 'ready',
        tag: args.tag,
        phase: 'verified',
        filename: `feedback-mobile-edition-${args.tag}-windows-setup.zip`,
        reason: 'Verified update package for later install.',
      });
    if (command === 'get_setup_bundle_update_state') return typeof updateInstallState === 'function'
      ? updateInstallState(args)
      : clone(updateInstallState || {
        status: 'available',
        tag: args.tag,
        phase: 'available',
        reason: 'Update is available for download.',
      });
    if (command === 'install_setup_bundle_update') return typeof updateInstallResult === 'function'
      ? updateInstallResult(args, emitTauriEvent)
      : clone(updateInstallResult || {
        status: 'ready',
        tag: args.tag,
        phase: 'installed',
        reason: 'Update installed side by side. Open the new version when ready.',
      });
    if (command === 'open_installed_setup_bundle_update') return typeof updateOpenResult === 'function'
      ? updateOpenResult(args)
      : clone(updateOpenResult || {
        status: 'opened',
        tag: args.tag,
        reason: 'New version opened.',
      });
    if (command === 'get_setup_bundle_activation_state') return typeof updateActivationState === 'function'
      ? updateActivationState(args)
      : clone(updateActivationState || {
        status: 'unavailable',
        tag: '',
        reason: 'This checkout cannot be made current.',
      });
    if (command === 'activate_setup_bundle_current') return typeof updateActivationResult === 'function'
      ? updateActivationResult(args)
      : clone(updateActivationResult || {
        status: 'current',
        tag: 'v0.3.1',
        reason: 'Current version saved. The original setup launcher will open this version next time.',
      });
    if (command === 'get_setup_bundle_version_inventory') return typeof versionInventory === 'function'
      ? versionInventory(args)
      : clone(versionInventory || {
        status: 'unavailable',
        versions: [],
        currentSource: '',
        currentTag: '',
        runningTag: '',
        reason: 'Version management is unavailable for this checkout.',
      });
    if (command === 'select_setup_bundle_version_current') return typeof versionSelectResult === 'function'
      ? versionSelectResult(args)
      : clone(versionSelectResult || {
        status: 'selected',
        currentSource: 'managed',
        currentTag: args.tag,
        reason: `Current version saved. The original setup launcher will open ${args.tag} next time.`,
        inventory: {
          status: 'ready',
          versions: [{ tag: 'v0.4.0' }, { tag: 'v0.3.1' }],
          currentSource: 'managed',
          currentTag: args.tag,
          runningTag: 'v0.3.1',
          reason: `The original setup launcher will open ${args.tag} next time.`,
        },
      });
    if (command === 'restore_bundled_setup_current') return typeof versionRestoreResult === 'function'
      ? versionRestoreResult(args)
      : clone(versionRestoreResult || {
        status: 'bundled',
        currentSource: 'bundled',
        currentTag: '',
        reason: 'Bundled version restored. The original setup launcher will use its bundled Companion next time.',
        inventory: {
          status: 'ready',
          versions: [{ tag: 'v0.4.0' }, { tag: 'v0.3.1' }],
          currentSource: 'bundled',
          currentTag: '',
          runningTag: 'v0.3.1',
          reason: 'The original setup launcher will use its bundled Companion next time.',
        },
      });
    if (command === 'run_device_action') return typeof deviceResult === 'function'
      ? deviceResult(args)
      : clone(deviceResult);
    if (command === 'run_server_action') return typeof serverResult === 'function'
      ? serverResult(args)
      : clone(serverResult);
    if (command === 'choose_library_folder') return libraryFolder;
    if (command === 'validate_library_folder') return clone(libraryValidation);
    if (command === 'configure_library') return typeof libraryResult === 'function'
      ? libraryResult(args)
      : clone(libraryResult);
    if (command === 'get_library_state') return { valid: true, path: 'C:\\Music', reason: 'Library ready.' };
    throw new Error(`Unexpected command ${command}`);
  };

  globalThis.document = document;
  globalThis.window = {
    __TAURI__: {
      core: { invoke },
      event: {
        listen: async (name, handler) => {
          const listeners = eventListeners.get(name) || [];
          listeners.push(handler);
          eventListeners.set(name, listeners);
          return () => {};
        },
      },
    },
    fetch: fetchImpl || (async () => ({
      ok: true,
      json: async () => clone(latestRelease),
    })),
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener() {},
  };

  await import(`../src/main.js?test=${Date.now()}-${Math.random()}`);
  await tick();
  await tick();
  await tick();
  await tick();
  return { document, calls, emitTauriEvent };
}

test('ready Check view exposes a compact device-guide action', async () => {
  const { document } = await importMainWithHarness({
    statusPayload: await fixture('ready'),
    deviceResult: { status: 'ready', reason: 'Device guide created and opened.' },
  });

  const row = document.elements.get('check-action-row');
  const button = document.elements.get('check-action');
  assert.equal(row.hidden, false);
  assert.equal(button.disabled, false);
  assert.equal(button.dataset.action, 'open_guide');
  assert.equal(button.textContent, 'Connect phone / tablet');
  assert.equal(document.elements.get('check-action-message').hidden, true);
});

test('status band grid placement uses compact action layout without reserved empty message column', async () => {
  const html = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  const tauriConfig = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));

  assert.match(html, /class="status-heading"/);
  assert.match(html, /class="status-text-stack"/);
  assert.match(html, /id="update-status"/);
  assert.match(html, /id="update-heading"/);
  assert.match(html, /id="review-update"[^>]*hidden[^>]*disabled/);
  assert.match(html, /id="download-update"[^>]*hidden[^>]*disabled/);
  assert.match(html, /id="install-update"[^>]*hidden[^>]*disabled/);
  assert.match(html, /id="open-update"[^>]*hidden[^>]*disabled/);
  assert.match(html, /Try new version/);
  assert.match(html, /id="default-version-field"[^>]*class="default-version-field"[^>]*hidden/);
  assert.match(html, /<span>Default version<\/span>/);
  assert.match(html, /id="default-version-select"[^>]*class="version-select"[^>]*disabled/);
  assert.match(html, /id="save-default-version"[^>]*hidden[^>]*disabled/);
  assert.doesNotMatch(html, /id="make-current"/);
  assert.doesNotMatch(html, /id="use-selected-version"/);
  assert.doesNotMatch(html, /id="use-bundled-version"/);
  assert.doesNotMatch(html, />Make current</);
  assert.doesNotMatch(html, />Use selected version</);
  assert.doesNotMatch(html, />Use bundled version</);
  assert.doesNotMatch(html, />Open new version</);
  assert.match(html, /id="update-progress"[^>]*hidden/);
  assert.match(html, /class="status-update tone-attention"/);
  assert.doesNotMatch(html, /<section[^>]+id="update-status"/);
  assert.doesNotMatch(html, /status-update-message/);
  assert.doesNotMatch(html, /extract update/i);
  assert.doesNotMatch(html, /repair update/i);
  assert.doesNotMatch(html, /rollback/i);
  assert.match(html, /id="check-action-message"[^>]*hidden/);
  assert.doesNotMatch(css, /\.status-band\s*>\s*div\s*\{/);
  assert.doesNotMatch(css, /\.update-status\s*\{/);
  assert.doesNotMatch(css, /min-height:\s*4\.4rem/);
  assert.doesNotMatch(css, /min-height:\s*4\.15rem/);
  assert.doesNotMatch(css, /flex-basis:\s*100%/);
  assert.doesNotMatch(css, /minmax\(9rem,\s*16rem\)/);
  assert.match(css, /\.status-heading\s*\{[\s\S]*?grid-column:\s*1;/);
  assert.match(css, /\.status-copy\s*\{[\s\S]*?grid-column:\s*2;/);
  assert.match(css, /\.status-text-stack\s*\{[\s\S]*?flex:\s*1 1 auto;/);
  assert.match(css, /\.checks-section\s*\{[\s\S]*?padding:\s*0\.7rem 1\.2rem 0\.75rem;/);
  assert.match(css, /\.section-head\s*\{[\s\S]*?padding-bottom:\s*0\.55rem;/);
  assert.match(css, /\.check-row\s*\{[\s\S]*?min-height:\s*4rem;/);
  assert.match(css, /\.check-row\s*\{[\s\S]*?padding:\s*0\.58rem 0\.85rem;/);
  assert.match(css, /\.check-action-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(12\.5rem,\s*auto\);/);
  assert.match(css, /\.status-update\s*\{[\s\S]*?flex-wrap:\s*wrap;/);
  assert.match(css, /\.status-update-label\s*\{[\s\S]*?text-transform:\s*uppercase;/);
  assert.match(css, /\.review-update-action\s*\{[\s\S]*?min-height:\s*1\.7rem;/);
  assert.match(css, /\.review-update-action\[hidden\]\s*\{[\s\S]*?display:\s*none;/);
  assert.match(css, /\.default-version-field\s*\{[\s\S]*?display:\s*inline-flex;/);
  assert.match(css, /\.default-version-field\[hidden\]\s*\{[\s\S]*?display:\s*none;/);
  assert.match(css, /\.version-select\s*\{[\s\S]*?min-height:\s*1\.7rem;/);
  assert.match(css, /\.version-select\[hidden\]\s*\{[\s\S]*?display:\s*none;/);
  assert.match(css, /\.update-progress\s*\{[\s\S]*?white-space:\s*nowrap;/);
  assert.match(css, /\.update-progress\[hidden\]\s*\{[\s\S]*?display:\s*none;/);
  assert.match(css, /\.check-action-row p\[hidden\]\s*\{[\s\S]*?display:\s*none;/);
  assert.match(css, /@media\s*\(max-width:\s*820px\)\s*\{[\s\S]*?\.status-copy\s*\{[\s\S]*?grid-column:\s*1;/);
  assert.match(tauriConfig.app.security.csp, /connect-src ipc: http:\/\/ipc\.localhost https:\/\/api\.github\.com/);
  assert.doesNotMatch(tauriConfig.app.security.csp, /https:\/\/\*/);
});

test('Check view renders read-only development update status from fixed latest release check', async () => {
  const fetchCalls = [];
  const { document, calls } = await importMainWithHarness({
    statusPayload: await fixture('ready'),
    deviceResult: { status: 'ready', reason: 'Device guide created and opened.' },
    updateIdentity: {
      status: 'ready',
      source: 'development_checkout',
      localVersion: '0.3.0',
      localTag: 'v0.3.0',
      latestStableReleaseApiUrl: 'https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest',
      reason: 'Development checkout identity resolved.',
    },
    fetchImpl: async (url) => {
      fetchCalls.push(url);
      return {
        ok: true,
        json: async () => ({ tag_name: 'v0.3.0', prerelease: false, draft: false }),
      };
    },
  });
  await tick();
  await tick();

  assert.equal(calls.some((call) => call.command === 'get_update_identity'), true);
  assert.deepEqual(fetchCalls, ['https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest']);
  assert.equal(document.elements.get('update-heading').textContent, 'Development checkout');
  assert.match(document.elements.get('update-summary').textContent, /matching the latest stable release/);
  assert.equal(document.elements.get('update-versions').textContent, 'Local v0.3.0 / Latest stable v0.3.0');
  assert.equal(document.elements.get('review-update').hidden, true);
});

test('Check view reviews only a validated newer stable release through the native tag command', async () => {
  let resolveReview;
  const reviewAction = new Promise((resolve) => {
    resolveReview = resolve;
  });
  const { document, calls } = await importMainWithHarness({
    statusPayload: await fixture('ready'),
    updateIdentity: {
      status: 'ready',
      source: 'setup_bundle',
      localVersion: '0.3.0',
      localTag: 'v0.3.0',
      latestStableReleaseApiUrl: 'https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest',
      reason: 'Installed setup bundle identity resolved.',
    },
    latestRelease: { tag_name: 'v0.3.1', prerelease: false, draft: false },
    updateReviewResult: () => reviewAction,
  });
  await tick();
  await tick();

  const button = document.elements.get('review-update');
  assert.equal(document.elements.get('update-heading').textContent, 'Update available');
  assert.equal(document.elements.get('update-versions').textContent, 'Local v0.3.0 / Latest stable v0.3.1');
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Review update');

  button.click();
  await tick();

  assert.deepEqual(
    calls.filter((call) => call.command === 'review_available_update').map((call) => call.args),
    [{ tag: 'v0.3.1' }],
  );
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'Opening...');

  button.click();
  await tick();
  assert.equal(calls.filter((call) => call.command === 'review_available_update').length, 1);

  resolveReview({
    status: 'opened',
    tag: 'v0.3.1',
    reason: 'Opened the v0.3.1 Mobile Edition release page.',
  });
  await tick();
  await tick();

  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Review update');
  assert.equal(document.elements.get('update-summary').textContent, 'Release page opened.');
  assert.equal(document.elements.get('update-summary').textContent.length <= 24, true);
  assert.match(document.elements.get('update-summary').className, /tone-ready/);
  assert.equal(
    calls.some((call) => /download|install|repair|rollback/i.test(call.command)),
    false,
  );
});

test('Check view offers setup-bundle download only for a validated newer stable release', async () => {
  const setupBundleHarness = await importMainWithHarness({
    statusPayload: await fixture('ready'),
    updateIdentity: {
      status: 'ready',
      source: 'setup_bundle',
      localVersion: '0.3.0',
      localTag: 'v0.3.0',
      latestStableReleaseApiUrl: 'https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest',
      reason: 'Installed setup bundle identity resolved.',
    },
    latestRelease: { tag_name: 'v0.3.1', prerelease: false, draft: false },
  });
  await tick();
  await tick();

  assert.equal(setupBundleHarness.document.elements.get('review-update').hidden, false);
  assert.equal(setupBundleHarness.document.elements.get('download-update').hidden, false);
  assert.equal(setupBundleHarness.document.elements.get('install-update').hidden, true);
  assert.equal(setupBundleHarness.document.elements.get('open-update').hidden, true);
  assert.equal(setupBundleHarness.document.elements.get('download-update').textContent, 'Download update');
  assert.equal(setupBundleHarness.document.elements.get('update-versions').textContent, 'Local v0.3.0 / Latest stable v0.3.1');

  const developmentHarness = await importMainWithHarness({
    statusPayload: await fixture('ready'),
    updateIdentity: {
      status: 'ready',
      source: 'development_checkout',
      localVersion: '0.3.0',
      localTag: 'v0.3.0',
      latestStableReleaseApiUrl: 'https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest',
      reason: 'Development checkout identity resolved.',
    },
    latestRelease: { tag_name: 'v0.3.1', prerelease: false, draft: false },
  });
  await tick();
  await tick();

  assert.equal(developmentHarness.document.elements.get('review-update').hidden, false);
  assert.equal(developmentHarness.document.elements.get('download-update').hidden, true);
  assert.equal(developmentHarness.document.elements.get('install-update').hidden, true);
  assert.equal(developmentHarness.document.elements.get('open-update').hidden, true);
  assert.equal(developmentHarness.document.elements.get('default-version-field').hidden, true);
  assert.equal(developmentHarness.document.elements.get('save-default-version').hidden, true);
  assert.equal(developmentHarness.calls.some((call) => call.command === 'get_setup_bundle_version_inventory'), false);
});

test('Download update stages through the native tag command with progress and duplicate prevention', async () => {
  let resolveStage;
  const stageAction = new Promise((resolve) => {
    resolveStage = resolve;
  });
  const { document, calls, emitTauriEvent } = await importMainWithHarness({
    statusPayload: await fixture('ready'),
    updateIdentity: {
      status: 'ready',
      source: 'setup_bundle',
      localVersion: '0.3.0',
      localTag: 'v0.3.0',
      latestStableReleaseApiUrl: 'https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest',
      reason: 'Installed setup bundle identity resolved.',
    },
    latestRelease: { tag_name: 'v0.3.1', prerelease: false, draft: false },
    updateStageResult: () => stageAction,
  });
  await tick();
  await tick();

  const download = document.elements.get('download-update');
  const review = document.elements.get('review-update');
  download.click();
  await tick();

  assert.deepEqual(
    calls.filter((call) => call.command === 'stage_setup_bundle_update').map((call) => call.args),
    [{ tag: 'v0.3.1' }],
  );
  assert.equal(download.disabled, true);
  assert.equal(review.disabled, true);
  assert.equal(download.textContent, 'Downloading...');

  download.click();
  await tick();
  assert.equal(calls.filter((call) => call.command === 'stage_setup_bundle_update').length, 1);

  emitTauriEvent('setup-bundle-update-progress', {
    tag: 'v0.3.1',
    phase: 'downloading',
    label: 'Downloading update',
    bytesDownloaded: 50,
    bytesTotal: 100,
  });
  assert.equal(document.elements.get('update-summary').textContent, 'Downloading update');
  assert.equal(document.elements.get('update-progress').textContent, '50 B / 100 B (50%)');
  assert.equal(document.elements.get('update-progress').hidden, false);

  resolveStage({
    status: 'ready',
    tag: 'v0.3.1',
    phase: 'verified',
    filename: 'feedback-mobile-edition-v0.3.1-windows-setup.zip',
    reason: 'Verified update package for later install.',
    bytesDownloaded: 100,
    bytesTotal: 100,
  });
  await tick();
  await tick();

  assert.equal(review.disabled, false);
  assert.equal(download.hidden, true);
  assert.equal(document.elements.get('install-update').hidden, false);
  assert.equal(document.elements.get('install-update').textContent, 'Install update');
  assert.equal(document.elements.get('update-summary').textContent, 'Verified update ready for later install.');
  assert.match(document.elements.get('update-summary').className, /tone-ready/);
  assert.equal(document.elements.get('update-progress').hidden, true);
});

test('Check view persists downloaded and installed setup-bundle states from native query', async () => {
  const downloadedHarness = await importMainWithHarness({
    statusPayload: await fixture('ready'),
    updateIdentity: {
      status: 'ready',
      source: 'setup_bundle',
      localVersion: '0.3.0',
      localTag: 'v0.3.0',
      latestStableReleaseApiUrl: 'https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest',
      reason: 'Installed setup bundle identity resolved.',
    },
    latestRelease: { tag_name: 'v0.3.1', prerelease: false, draft: false },
    updateInstallState: { status: 'downloaded', tag: 'v0.3.1', phase: 'downloaded', reason: 'Verified update ready to install.' },
  });
  await tick();
  await tick();

  assert.equal(downloadedHarness.document.elements.get('update-heading').textContent, 'Update downloaded');
  assert.equal(downloadedHarness.document.elements.get('review-update').hidden, false);
  assert.equal(downloadedHarness.document.elements.get('download-update').hidden, true);
  assert.equal(downloadedHarness.document.elements.get('install-update').hidden, false);
  assert.equal(downloadedHarness.document.elements.get('open-update').hidden, true);
  assert.deepEqual(
    downloadedHarness.calls.filter((call) => call.command === 'get_setup_bundle_update_state').map((call) => call.args),
    [{ tag: 'v0.3.1' }],
  );

  const installedHarness = await importMainWithHarness({
    statusPayload: await fixture('ready'),
    updateIdentity: {
      status: 'ready',
      source: 'setup_bundle',
      localVersion: '0.3.0',
      localTag: 'v0.3.0',
      latestStableReleaseApiUrl: 'https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest',
      reason: 'Installed setup bundle identity resolved.',
    },
    latestRelease: { tag_name: 'v0.3.1', prerelease: false, draft: false },
    updateInstallState: { status: 'installed', tag: 'v0.3.1', phase: 'installed', reason: 'Update installed.' },
  });
  await tick();
  await tick();

  assert.equal(installedHarness.document.elements.get('update-heading').textContent, 'Update installed');
  assert.equal(installedHarness.document.elements.get('review-update').hidden, false);
  assert.equal(installedHarness.document.elements.get('download-update').hidden, true);
  assert.equal(installedHarness.document.elements.get('install-update').hidden, true);
  assert.equal(installedHarness.document.elements.get('open-update').hidden, false);
});

test('Install update is explicit, shows progress, prevents duplicates, and reveals Try new version', async () => {
  let resolveInstall;
  const installAction = new Promise((resolve) => {
    resolveInstall = resolve;
  });
  const { document, calls, emitTauriEvent } = await importMainWithHarness({
    statusPayload: await fixture('ready'),
    updateIdentity: {
      status: 'ready',
      source: 'setup_bundle',
      localVersion: '0.3.0',
      localTag: 'v0.3.0',
      latestStableReleaseApiUrl: 'https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest',
      reason: 'Installed setup bundle identity resolved.',
    },
    latestRelease: { tag_name: 'v0.3.1', prerelease: false, draft: false },
    updateInstallState: { status: 'downloaded', tag: 'v0.3.1', phase: 'downloaded', reason: 'Verified update ready to install.' },
    updateInstallResult: () => installAction,
  });
  await tick();
  await tick();

  const install = document.elements.get('install-update');
  install.click();
  await tick();

  assert.deepEqual(
    calls.filter((call) => call.command === 'install_setup_bundle_update').map((call) => call.args),
    [{ tag: 'v0.3.1' }],
  );
  assert.equal(install.disabled, true);
  assert.equal(document.elements.get('review-update').disabled, true);
  assert.equal(install.textContent, 'Installing...');

  install.click();
  await tick();
  assert.equal(calls.filter((call) => call.command === 'install_setup_bundle_update').length, 1);
  assert.equal(calls.some((call) => /open|docker|tailscale|server/i.test(call.command) && call.command !== 'get_setup_status'), false);

  emitTauriEvent('setup-bundle-install-progress', {
    tag: 'v0.3.1',
    phase: 'installing',
    label: 'Installing update',
    bytesProcessed: 75,
    bytesTotal: 100,
  });
  assert.equal(document.elements.get('update-summary').textContent, 'Installing update');
  assert.equal(document.elements.get('update-progress').textContent, '75 B / 100 B (75%)');

  resolveInstall({
    status: 'ready',
    tag: 'v0.3.1',
    phase: 'installed',
    reason: 'Update installed side by side. Try the new version when ready.',
  });
  await tick();
  await tick();

  assert.equal(document.elements.get('install-update').hidden, true);
  assert.equal(document.elements.get('open-update').hidden, false);
  assert.equal(document.elements.get('open-update').textContent, 'Try new version');
  assert.equal(document.elements.get('update-summary').textContent, 'Update installed. Try when ready.');
  assert.equal(document.elements.get('update-progress').hidden, true);
});

test('Try new version is explicit, invokes only native open, and failure stays bounded', async () => {
  const { document, calls } = await importMainWithHarness({
    statusPayload: await fixture('ready'),
    updateIdentity: {
      status: 'ready',
      source: 'setup_bundle',
      localVersion: '0.3.0',
      localTag: 'v0.3.0',
      latestStableReleaseApiUrl: 'https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest',
      reason: 'Installed setup bundle identity resolved.',
    },
    latestRelease: { tag_name: 'v0.3.1', prerelease: false, draft: false },
    updateInstallState: { status: 'installed', tag: 'v0.3.1', phase: 'installed', reason: 'Update installed.' },
    updateOpenResult: async () => {
      const error = new Error('C:\\Users\\person\\secret path failed');
      error.code = 'update_launch_failed';
      throw error;
    },
  });
  await tick();
  await tick();

  document.elements.get('open-update').click();
  await tick();
  await tick();

  assert.deepEqual(
    calls.filter((call) => call.command === 'open_installed_setup_bundle_update').map((call) => call.args),
    [{ tag: 'v0.3.1' }],
  );
  assert.equal(document.elements.get('update-summary').textContent, 'Could not try new version.');
  assert.doesNotMatch(document.elements.get('update-summary').textContent, /secret|C:\\Users/);
  assert.equal(document.elements.get('open-update').disabled, false);
});

test('Default version selector remains available offline and saves a managed version explicitly', async () => {
  let resolveSelection;
  const selectionAction = new Promise((resolve) => {
    resolveSelection = resolve;
  });
  let currentTag = 'v0.3.1';
  let activationStateCalls = 0;
  let inventoryCalls = 0;
  const { document, calls } = await importMainWithHarness({
    statusPayload: await fixture('ready'),
    updateIdentity: {
      status: 'ready',
      source: 'setup_bundle',
      localVersion: '0.3.1',
      localTag: 'v0.3.1',
      latestStableReleaseApiUrl: 'https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest',
      reason: 'Installed setup bundle identity resolved.',
    },
    updateActivationState: () => {
      activationStateCalls += 1;
      return {
        status: currentTag === 'v0.3.1' ? 'current' : 'activatable',
        tag: 'v0.3.1',
        reason: currentTag === 'v0.3.1'
          ? 'The original setup launcher will open this version next time.'
          : 'Make this version current for the original setup launcher.',
      };
    },
    versionInventory: () => {
      inventoryCalls += 1;
      return {
        status: 'ready',
        versions: [{ tag: 'v0.4.0' }, { tag: 'v0.3.1' }, { tag: 'v0.2.0' }],
        currentSource: 'managed',
        currentTag,
        runningTag: 'v0.3.1',
        reason: `The original setup launcher will open ${currentTag} next time.`,
      };
    },
    versionSelectResult: () => selectionAction.then((payload) => {
      currentTag = 'v0.4.0';
      return payload;
    }),
    fetchImpl: async () => {
      throw new Error('simulated latest-release outage');
    },
  });
  await tick();
  await tick();
  await tick();

  const field = document.elements.get('default-version-field');
  const select = document.elements.get('default-version-select');
  const save = document.elements.get('save-default-version');
  assert.equal(calls.filter((call) => call.command === 'get_setup_bundle_version_inventory').length, 1);
  assert.equal(document.elements.get('update-heading').textContent, 'Setup version');
  assert.equal(document.elements.get('update-summary').textContent, 'This window: v0.3.1. Opens next time: v0.3.1.');
  assert.equal(document.elements.get('update-versions').textContent, 'Local v0.3.1');
  assert.equal(field.hidden, false);
  assert.deepEqual(select.children.map((child) => child.value), [
    'original-setup-version',
    'v0.4.0',
    'v0.3.1',
    'v0.2.0',
  ]);
  assert.deepEqual(select.children.map((child) => child.textContent), [
    'Original setup version',
    'v0.4.0',
    'v0.3.1',
    'v0.2.0',
  ]);
  assert.equal(select.value, 'v0.3.1');
  assert.equal(save.hidden, false);
  assert.equal(save.disabled, true);
  assert.equal(calls.some((call) => call.command === 'select_setup_bundle_version_current'), false);
  assert.equal(calls.some((call) => call.command === 'restore_bundled_setup_current'), false);
  assert.equal(calls.some((call) => call.command === 'activate_setup_bundle_current'), false);

  select.change('v0.4.0');
  await tick();
  assert.equal(save.disabled, false);
  assert.equal(save.dataset.defaultVersion, 'v0.4.0');
  assert.equal(calls.some((call) => call.command === 'select_setup_bundle_version_current'), false);

  save.click();
  await tick();
  assert.deepEqual(
    calls.filter((call) => call.command === 'select_setup_bundle_version_current').map((call) => call.args),
    [{ tag: 'v0.4.0' }],
  );
  assert.equal(select.disabled, true);
  assert.equal(save.textContent, 'Saving...');

  save.click();
  await tick();
  assert.equal(calls.filter((call) => call.command === 'select_setup_bundle_version_current').length, 1);

  resolveSelection({
    status: 'selected',
    currentSource: 'managed',
    currentTag: 'v0.4.0',
    reason: 'Current version saved. The original setup launcher will open v0.4.0 next time.',
    inventory: {
      status: 'ready',
      versions: [{ tag: 'v0.4.0' }, { tag: 'v0.3.1' }, { tag: 'v0.2.0' }],
      currentSource: 'managed',
      currentTag: 'v0.4.0',
      runningTag: 'v0.3.1',
      reason: 'The original setup launcher will open v0.4.0 next time.',
    },
  });
  await tick();
  await tick();
  await tick();

  assert.equal(document.elements.get('update-heading').textContent, 'Setup version');
  assert.equal(document.elements.get('update-summary').textContent, 'Default saved. Opens next time: v0.4.0.');
  assert.equal(activationStateCalls, 2);
  assert.equal(inventoryCalls, 2);
  assert.deepEqual(select.children.map((child) => child.value), [
    'original-setup-version',
    'v0.4.0',
    'v0.3.1',
    'v0.2.0',
  ]);
  assert.equal(select.value, 'v0.4.0');
  assert.equal(save.disabled, true);
});

test('Default version selector restores the original setup version explicitly', async () => {
  let currentSource = 'managed';
  let activationStateCalls = 0;
  let inventoryCalls = 0;
  const { document, calls } = await importMainWithHarness({
    statusPayload: await fixture('ready'),
    updateIdentity: {
      status: 'ready',
      source: 'setup_bundle',
      localVersion: '0.3.1',
      localTag: 'v0.3.1',
      latestStableReleaseApiUrl: 'https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest',
      reason: 'Installed setup bundle identity resolved.',
    },
    updateActivationState: () => {
      activationStateCalls += 1;
      return {
        status: currentSource === 'managed' ? 'current' : 'activatable',
        tag: 'v0.3.1',
        reason: currentSource === 'managed'
          ? 'The original setup launcher will open this version next time.'
          : 'Make this version current for the original setup launcher.',
      };
    },
    versionInventory: () => {
      inventoryCalls += 1;
      return {
        status: 'ready',
        versions: [{ tag: 'v0.4.0' }, { tag: 'v0.3.1' }],
        currentSource,
        currentTag: currentSource === 'managed' ? 'v0.3.1' : '',
        runningTag: 'v0.3.1',
        reason: currentSource === 'managed'
          ? 'The original setup launcher will open v0.3.1 next time.'
          : 'The original setup launcher will use its bundled Companion next time.',
      };
    },
    versionRestoreResult: () => {
      currentSource = 'bundled';
      return {
        status: 'bundled',
        currentSource: 'bundled',
        currentTag: '',
        reason: 'Bundled version restored. The original setup launcher will use its bundled Companion next time.',
        inventory: {
          status: 'ready',
          versions: [{ tag: 'v0.4.0' }, { tag: 'v0.3.1' }],
          currentSource: 'bundled',
          currentTag: '',
          runningTag: 'v0.3.1',
          reason: 'The original setup launcher will use its bundled Companion next time.',
        },
      };
    },
  });
  await tick();
  await tick();

  const select = document.elements.get('default-version-select');
  const save = document.elements.get('save-default-version');
  assert.equal(document.elements.get('update-heading').textContent, 'Setup version');
  assert.equal(document.elements.get('update-summary').textContent, 'This window: v0.3.1. Opens next time: v0.3.1.');
  assert.equal(select.value, 'v0.3.1');
  assert.equal(save.disabled, true);

  select.change('original-setup-version');
  await tick();
  assert.equal(save.disabled, false);
  save.click();
  await tick();
  await tick();
  await tick();

  assert.deepEqual(
    calls.filter((call) => call.command === 'restore_bundled_setup_current').map((call) => call.args),
    [{}],
  );
  assert.equal(calls.some((call) => call.command === 'select_setup_bundle_version_current'), false);
  assert.equal(document.elements.get('update-heading').textContent, 'Setup version');
  assert.equal(document.elements.get('update-summary').textContent, 'Default saved. Opens next time: Original setup version.');
  assert.equal(activationStateCalls, 2);
  assert.equal(inventoryCalls, 2);
  assert.deepEqual(select.children.map((child) => child.value), ['original-setup-version', 'v0.4.0', 'v0.3.1']);
  assert.equal(select.value, 'original-setup-version');
  assert.equal(save.disabled, true);
  assert.equal(
    calls.some((call) => /open|docker|tailscale|server|install|stage/i.test(call.command)),
    false,
  );
});

test('Invalid default presents no fake selection and save failures stay bounded', async () => {
  const { document, calls } = await importMainWithHarness({
    statusPayload: await fixture('ready'),
    updateIdentity: {
      status: 'ready',
      source: 'setup_bundle',
      localVersion: '0.3.1',
      localTag: 'v0.3.1',
      latestStableReleaseApiUrl: 'https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest',
      reason: 'Installed setup bundle identity resolved.',
    },
    latestRelease: { tag_name: 'v0.3.1', prerelease: false, draft: false },
    updateActivationState: {
      status: 'invalid_current',
      tag: 'v0.3.1',
      reason: 'C:\\Users\\person\\secret current record failed',
    },
    versionInventory: {
      status: 'ready',
      versions: [{ tag: 'v0.4.0' }, { tag: 'v0.3.1' }],
      currentSource: 'invalid',
      currentTag: '',
      runningTag: 'v0.3.1',
      reason: 'C:\\Users\\person\\secret current record failed',
    },
    versionSelectResult: async () => {
      const error = new Error('C:\\Users\\person\\secret selection failed');
      error.code = 'version_selection_failed';
      throw error;
    },
  });
  await tick();
  await tick();

  const select = document.elements.get('default-version-select');
  const save = document.elements.get('save-default-version');
  assert.equal(document.elements.get('update-heading').textContent, 'Needs selection');
  assert.equal(document.elements.get('update-summary').textContent, 'This window: v0.3.1. Opens next time: choose a default version.');
  assert.doesNotMatch(document.elements.get('update-summary').textContent, /secret|C:\\Users/);
  assert.equal(select.value, '');
  assert.deepEqual(select.children.map((child) => child.value), ['', 'original-setup-version', 'v0.4.0', 'v0.3.1']);
  assert.equal(save.disabled, true);
  assert.equal(calls.some((call) => call.command === 'select_setup_bundle_version_current'), false);

  select.change('v0.4.0');
  await tick();
  assert.equal(save.disabled, false);
  save.click();
  await tick();
  await tick();

  assert.deepEqual(
    calls.filter((call) => call.command === 'select_setup_bundle_version_current').map((call) => call.args),
    [{ tag: 'v0.4.0' }],
  );
  assert.equal(document.elements.get('update-summary').textContent, 'Could not save default version.');
  assert.doesNotMatch(document.elements.get('update-summary').textContent, /secret|C:\\Users/);
  assert.equal(save.hidden, false);
  assert.equal(save.disabled, false);
});

test('Download update failure stays concise and keeps retry and review available', async () => {
  const { document } = await importMainWithHarness({
    statusPayload: await fixture('ready'),
    updateIdentity: {
      status: 'ready',
      source: 'setup_bundle',
      localVersion: '0.3.0',
      localTag: 'v0.3.0',
      latestStableReleaseApiUrl: 'https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest',
      reason: 'Installed setup bundle identity resolved.',
    },
    latestRelease: { tag_name: 'v0.3.1', prerelease: false, draft: false },
    updateStageResult: async () => {
      const error = new Error('C:\\Users\\person\\secret\\cache failed with token detail');
      error.code = 'update_verification_failed';
      throw error;
    },
  });
  await tick();
  await tick();

  document.elements.get('download-update').click();
  await tick();
  await tick();

  assert.equal(document.elements.get('update-summary').textContent, 'Verification failed. Retry update.');
  assert.doesNotMatch(document.elements.get('update-summary').textContent, /secret|token|C:\\Users/);
  assert.match(document.elements.get('update-summary').className, /tone-error/);
  assert.equal(document.elements.get('download-update').disabled, false);
  assert.equal(document.elements.get('review-update').disabled, false);
});

test('stale update staging results cannot overwrite a newer operation', async () => {
  let resolveFirst;
  let resolveSecond;
  const first = new Promise((resolve) => {
    resolveFirst = resolve;
  });
  const second = new Promise((resolve) => {
    resolveSecond = resolve;
  });
  let stageCalls = 0;
  const { document } = await importMainWithHarness({
    statusPayload: await fixture('ready'),
    updateIdentity: {
      status: 'ready',
      source: 'setup_bundle',
      localVersion: '0.3.0',
      localTag: 'v0.3.0',
      latestStableReleaseApiUrl: 'https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest',
      reason: 'Installed setup bundle identity resolved.',
    },
    latestRelease: { tag_name: 'v0.3.1', prerelease: false, draft: false },
    updateStageResult: () => {
      stageCalls += 1;
      return stageCalls === 1 ? first : second;
    },
  });
  await tick();
  await tick();

  document.elements.get('download-update').click();
  await tick();
  resolveFirst({
    status: 'ready',
    tag: 'v0.3.1',
    phase: 'verified',
    filename: 'feedback-mobile-edition-v0.3.1-windows-setup.zip',
    reason: 'Verified update package for later install.',
  });
  await tick();
  await tick();
  document.elements.get('download-update').click();
  await tick();
  assert.equal(stageCalls, 1);
  resolveSecond({
    status: 'ready',
    tag: 'v0.3.1',
    phase: 'cached',
    filename: 'feedback-mobile-edition-v0.3.1-windows-setup.zip',
    reason: 'Verified cached update package for later install.',
  });
  await tick();
  await tick();

  assert.equal(document.elements.get('update-summary').textContent, 'Verified update ready for later install.');
});

test('Check view keeps update review failures inline and bounded', async () => {
  const { document } = await importMainWithHarness({
    statusPayload: await fixture('ready'),
    updateIdentity: {
      status: 'ready',
      source: 'setup_bundle',
      localVersion: '0.3.0',
      localTag: 'v0.3.0',
      latestStableReleaseApiUrl: 'https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest',
      reason: 'Installed setup bundle identity resolved.',
    },
    latestRelease: { tag_name: 'v0.3.1', prerelease: false, draft: false },
    updateReviewResult: async () => {
      throw new Error('Could not open the release page: simulated browser failure');
    },
  });
  await tick();
  await tick();
  const overallLabelBeforeReview = document.elements.get('overall-label').textContent;

  document.elements.get('review-update').click();
  await tick();
  await tick();

  assert.equal(document.elements.get('overall-label').textContent, overallLabelBeforeReview);
  assert.equal(
    document.elements.get('update-summary').textContent,
    'Could not open release page.',
  );
  assert.equal(document.elements.get('update-summary').textContent.length <= 28, true);
  assert.doesNotMatch(document.elements.get('update-summary').textContent, /simulated browser failure/);
  assert.match(document.elements.get('update-summary').className, /tone-error/);
  assert.equal(document.elements.get('review-update').disabled, false);
});

test('stale update refreshes cannot expose an obsolete review action', async () => {
  const pendingFetches = [];
  const { document } = await importMainWithHarness({
    statusPayload: await fixture('ready'),
    updateIdentity: {
      status: 'ready',
      source: 'setup_bundle',
      localVersion: '0.3.0',
      localTag: 'v0.3.0',
      latestStableReleaseApiUrl: 'https://api.github.com/repos/saleemk/feedBack-mobile-edition/releases/latest',
      reason: 'Installed setup bundle identity resolved.',
    },
    fetchImpl: async () => new Promise((resolve) => {
      pendingFetches.push(resolve);
    }),
  });
  await tick();
  assert.equal(document.elements.get('review-update').hidden, true);

  document.elements.get('refresh').click();
  await tick();
  document.elements.get('refresh').click();
  await tick();

  pendingFetches[2]({
    ok: true,
    json: async () => ({ tag_name: 'v0.3.2', prerelease: false, draft: false }),
  });
  await tick();
  await tick();

  assert.equal(document.elements.get('review-update').hidden, false);
  assert.equal(document.elements.get('review-update').textContent, 'Review update');

  pendingFetches[0]({
    ok: true,
    json: async () => ({ tag_name: 'v0.3.1', prerelease: false, draft: false }),
  });
  pendingFetches[1]({
    ok: true,
    json: async () => ({ tag_name: 'v0.3.0', prerelease: false, draft: false }),
  });
  await tick();
  await tick();

  assert.equal(document.elements.get('review-update').hidden, false);
  assert.equal(document.elements.get('review-update').textContent, 'Review update');
  assert.equal(document.elements.get('update-versions').textContent, 'Local v0.3.0 / Latest stable v0.3.2');
});

test('Check device-guide action invokes open_guide and keeps busy and success messages on Check', async () => {
  let resolveDeviceAction;
  const deviceAction = new Promise((resolve) => {
    resolveDeviceAction = resolve;
  });
  const { document, calls } = await importMainWithHarness({
    statusPayload: await fixture('ready'),
    deviceResult: () => deviceAction,
  });

  document.elements.get('check-action').click();
  await tick();

  assert.deepEqual(
    calls.filter((call) => call.command === 'run_device_action').map((call) => call.args.action),
    ['open_guide'],
  );
  assert.equal(document.elements.get('check-action').disabled, true);
  assert.equal(document.elements.get('check-action').textContent, 'Opening...');
  assert.match(document.elements.get('check-action-message').textContent, /local QR guide/);
  assert.equal(document.elements.get('check-action-message').hidden, false);

  resolveDeviceAction({ status: 'ready', reason: 'Device guide created and opened.' });
  await tick();
  await tick();

  assert.equal(document.elements.get('check-view').hidden, false);
  assert.equal(document.elements.get('check-action').disabled, false);
  assert.equal(document.elements.get('check-action-message').textContent, 'Device guide created and opened.');
  assert.equal(document.elements.get('check-action-message').hidden, false);
  assert.match(document.elements.get('check-action-message').className, /tone-ready/);
});

test('Check device-guide action keeps structured failure on Check', async () => {
  const { document } = await importMainWithHarness({
    statusPayload: await fixture('ready'),
    deviceResult: { status: 'failed', reason: 'Device guide helper returned an unreadable result.' },
  });

  document.elements.get('check-action').click();
  await tick();
  await tick();

  assert.equal(document.elements.get('check-view').hidden, false);
  assert.equal(
    document.elements.get('check-action-message').textContent,
    'Device guide helper returned an unreadable result.',
  );
  assert.equal(document.elements.get('check-action-message').hidden, false);
  assert.match(document.elements.get('check-action-message').className, /tone-error/);
});

test('Check action stays hidden for incomplete and ownership-conflict reports', async () => {
  const incomplete = clone(await fixture('ready'));
  incomplete.checks.privateHttps.status = 'needs_action';
  delete incomplete.checks.privateHttps.url;
  const incompleteHarness = await importMainWithHarness({
    statusPayload: incomplete,
    deviceResult: { status: 'ready', reason: 'Should not run.' },
  });
  assert.equal(incompleteHarness.document.elements.get('check-action-row').hidden, true);
  assert.equal(incompleteHarness.document.elements.get('check-action').disabled, true);

  const conflict = clone(await fixture('ready'));
  conflict.checks.docker.status = 'needs_action';
  conflict.checks.docker.reason = 'This checkout Docker service is not ready.';
  const conflictHarness = await importMainWithHarness({
    statusPayload: conflict,
    deviceResult: { status: 'ready', reason: 'Should not run.' },
  });
  assert.equal(conflictHarness.document.elements.get('check-action-row').hidden, true);
  assert.equal(conflictHarness.document.elements.get('check-action').disabled, true);
});

test('Devices action still invokes the existing open_guide path', async () => {
  const { document, calls } = await importMainWithHarness({
    statusPayload: await fixture('ready'),
    deviceResult: { status: 'ready', reason: 'Device guide created and opened.' },
  });

  document.viewButtons.find((button) => button.dataset.view === 'devices').click();
  document.elements.get('devices-action').click();
  await tick();

  assert.deepEqual(
    calls.filter((call) => call.command === 'run_device_action').map((call) => call.args.action),
    ['open_guide'],
  );
  assert.equal(document.elements.get('devices-message').textContent, 'Device guide created and opened.');
  assert.match(document.elements.get('devices-message').className, /tone-ready/);
});

test('server action enables Check guide action after ready status and busy cleanup', async () => {
  const initial = clone(await fixture('ready'));
  initial.checks.server.status = 'needs_action';
  initial.checks.server.reason = 'The local Mobile Edition server is not reachable on localhost.';
  initial.checks.privateHttps.status = 'needs_action';
  delete initial.checks.privateHttps.url;
  let resolveServerAction;
  const serverAction = new Promise((resolve) => {
    resolveServerAction = resolve;
  });
  const { document, calls } = await importMainWithHarness({
    statusPayload: initial,
    serverResult: () => serverAction,
    deviceResult: { status: 'ready', reason: 'Device guide created and opened.' },
  });

  assert.equal(document.elements.get('server-view').hidden, false);
  assert.equal(document.elements.get('server-action').disabled, false);

  document.elements.get('server-action').click();
  await tick();

  assert.deepEqual(
    calls.filter((call) => call.command === 'run_server_action').map((call) => call.args.action),
    ['start'],
  );
  assert.equal(document.elements.get('check-action').disabled, true);

  resolveServerAction({
    status: 'ready',
    reason: 'Server action finished. Setup doctor refreshed.',
    statusPayload: await fixture('ready'),
  });
  await tick();
  await tick();

  assert.equal(document.elements.get('check-view').hidden, false);
  assert.equal(document.elements.get('check-action-row').hidden, false);
  assert.equal(document.elements.get('check-action').disabled, false);
  assert.equal(document.elements.get('check-action').dataset.action, 'open_guide');
});

test('library apply shows saving and checking feedback through routing refresh', async () => {
  const initial = await fixture('needs-action');
  const serverStep = clone(await fixture('ready'));
  serverStep.checks.server.status = 'needs_action';
  serverStep.checks.server.reason = 'The local Mobile Edition server is not reachable on localhost.';
  serverStep.checks.privateHttps.status = 'needs_action';
  delete serverStep.checks.privateHttps.url;
  let statusCalls = 0;
  let resolveStatusRefresh;
  const statusRefresh = new Promise((resolve) => {
    resolveStatusRefresh = resolve;
  });
  let resolveLibrarySave;
  const librarySave = new Promise((resolve) => {
    resolveLibrarySave = resolve;
  });
  const { document } = await importMainWithHarness({
    statusPayload: initial,
    getStatus: () => {
      statusCalls += 1;
      return statusCalls === 1 ? initial : statusRefresh;
    },
    libraryResult: () => librarySave,
    deviceResult: { status: 'ready', reason: 'Device guide created and opened.' },
  });

  document.elements.get('browse-library').click();
  await tick();
  await tick();
  assert.equal(document.elements.get('apply-library').disabled, false);

  document.elements.get('apply-library').click();
  await tick();

  assert.equal(document.elements.get('apply-library').textContent, 'Saving...');
  assert.match(document.elements.get('library-message').textContent, /Saving this library/);
  assert.match(document.elements.get('library-message').textContent, /checking the next setup step/);

  resolveLibrarySave({ valid: true, path: 'C:\\Music', reason: 'Library saved.' });
  await tick();

  assert.equal(document.elements.get('apply-library').textContent, 'Saving...');
  assert.match(document.elements.get('library-message').textContent, /Library saved/);
  assert.match(document.elements.get('library-message').textContent, /Checking the server step/);

  resolveStatusRefresh(serverStep);
  await tick();
  await tick();

  assert.equal(document.elements.get('server-view').hidden, false);
});
