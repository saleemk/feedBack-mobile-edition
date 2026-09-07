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
  for (const id of ['refresh', 'check-action', 'browse-library', 'apply-library', 'server-action', 'devices-action']) {
    elements.get(id).tagName = 'BUTTON';
  }
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
  getStatus,
}) {
  const document = createDocument();
  const calls = [];
  const invoke = async (command, args = {}) => {
    calls.push({ command, args });
    if (command === 'get_setup_status') {
      const result = getStatus ? await getStatus(args) : statusPayload;
      return clone(result);
    }
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
    __TAURI__: { core: { invoke } },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    addEventListener() {},
  };

  await import(`../src/main.js?test=${Date.now()}-${Math.random()}`);
  await tick();
  await tick();
  return { document, calls };
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

  assert.match(html, /class="status-heading"/);
  assert.match(html, /id="check-action-message"[^>]*hidden/);
  assert.doesNotMatch(css, /\.status-band\s*>\s*div\s*\{/);
  assert.doesNotMatch(css, /minmax\(9rem,\s*16rem\)/);
  assert.match(css, /\.status-heading\s*\{[\s\S]*?grid-column:\s*1;/);
  assert.match(css, /\.status-copy\s*\{[\s\S]*?grid-column:\s*2;/);
  assert.match(css, /\.status-copy\s*>\s*p\s*\{[\s\S]*?flex:\s*1 1 auto;/);
  assert.match(css, /\.check-action-row\s*\{[\s\S]*?grid-template-columns:\s*minmax\(12\.5rem,\s*auto\);/);
  assert.match(css, /\.check-action-row p\[hidden\]\s*\{[\s\S]*?display:\s*none;/);
  assert.match(css, /@media\s*\(max-width:\s*820px\)\s*\{[\s\S]*?\.status-copy\s*\{[\s\S]*?grid-column:\s*1;/);
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
