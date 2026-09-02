import { buildRenderModel, buildServerModel } from './status-model.js';

const refreshButton = document.querySelector('#refresh');
const statusBand = document.querySelector('#status-band');
const overallLabel = document.querySelector('#overall-label');
const overallReason = document.querySelector('#overall-reason');
const generatedAt = document.querySelector('#generated-at');
const checksList = document.querySelector('#checks-list');
const viewButtons = [...document.querySelectorAll('[data-view]')];
const checkView = document.querySelector('#check-view');
const libraryView = document.querySelector('#library-view');
const serverView = document.querySelector('#server-view');
const footerMode = document.querySelector('#footer-mode');
const libraryBadge = document.querySelector('#library-badge');
const currentLibrary = document.querySelector('#current-library');
const selectedLibrary = document.querySelector('#selected-library');
const libraryMessage = document.querySelector('#library-message');
const browseLibraryButton = document.querySelector('#browse-library');
const applyLibraryButton = document.querySelector('#apply-library');
const serverBadge = document.querySelector('#server-badge');
const serverSummary = document.querySelector('#server-summary-text');
const serverChecksList = document.querySelector('#server-checks-list');
const serverMessage = document.querySelector('#server-message');
const serverActionButton = document.querySelector('#server-action');

let selectedPath = '';
let selectedPathIsValid = false;
let latestStatusPayload = null;
let serverActionRunning = false;
let serverActionMessage = '';
let serverActionTone = '';

function bridge() {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) throw new Error('Tauri bridge is unavailable.');
  return invoke;
}

function setBusy(isBusy) {
  refreshButton.disabled = isBusy || serverActionRunning;
  refreshButton.textContent = isBusy ? 'Refreshing...' : 'Refresh checks';
}

function renderError(error) {
  latestStatusPayload = null;
  statusBand.className = 'status-band tone-error';
  overallLabel.textContent = 'Setup doctor unavailable';
  overallReason.textContent = error?.message || 'The setup companion could not read the setup doctor.';
  generatedAt.textContent = '';
  checksList.replaceChildren();
  renderServerUnavailable(error);
}

function renderStatus(payload) {
  latestStatusPayload = payload;
  const model = buildRenderModel(payload);
  statusBand.className = `status-band tone-${model.overall.tone}`;
  overallLabel.textContent = model.overall.label;
  overallReason.textContent = model.overall.reason;
  generatedAt.textContent = model.generatedAt ? `Checked ${model.generatedAt}` : '';
  checksList.replaceChildren(...model.rows.map(renderRow));
  renderServerState();
}

function renderRow(row, index) {
  const item = document.createElement('article');
  item.className = `check-row tone-${row.tone}`;

  const marker = document.createElement('span');
  marker.className = 'check-marker';
  marker.textContent = String(index + 1).padStart(2, '0');
  marker.setAttribute('aria-hidden', 'true');

  const body = document.createElement('div');
  body.className = 'check-body';

  const titleLine = document.createElement('div');
  titleLine.className = 'check-title-line';

  const title = document.createElement('h3');
  title.textContent = row.label;

  const badge = document.createElement('span');
  badge.className = 'check-badge';
  badge.textContent = row.statusLabel;

  titleLine.append(title, badge);

  const reason = document.createElement('p');
  reason.className = 'check-reason';
  reason.textContent = row.reason;

  body.append(titleLine, reason);

  if (row.nextAction) {
    const next = document.createElement('p');
    next.className = 'check-next';
    next.textContent = row.nextAction;
    body.append(next);
  }

  if (row.url) {
    const url = document.createElement('p');
    url.className = 'check-url';
    url.textContent = row.url;
    body.append(url);
  }

  item.append(marker, body);
  return item;
}

async function refreshChecks() {
  setBusy(true);
  try {
    renderStatus(await bridge()('get_setup_status'));
  } catch (error) {
    renderError(error);
  } finally {
    setBusy(false);
  }
}

function renderLibraryState(result) {
  currentLibrary.textContent = result.path || 'No usable library is configured.';
  libraryBadge.textContent = result.valid ? 'Ready' : 'Needs action';
  libraryBadge.className = `library-badge ${result.valid ? 'tone-ready' : 'tone-attention'}`;
  libraryMessage.textContent = result.reason;
  libraryMessage.className = `library-message ${result.valid ? 'tone-ready' : 'tone-attention'}`;
}

function setLibraryBusy(isBusy, action = '') {
  browseLibraryButton.disabled = isBusy || serverActionRunning;
  applyLibraryButton.disabled = isBusy || serverActionRunning || !selectedPathIsValid;
  browseLibraryButton.textContent = isBusy && action === 'browse' ? 'Opening...' : 'Browse folders';
  applyLibraryButton.textContent = isBusy && action === 'apply' ? 'Saving...' : 'Use this library';
}

async function loadLibraryState() {
  setLibraryBusy(true);
  try {
    renderLibraryState(await bridge()('get_library_state'));
  } catch (error) {
    libraryBadge.textContent = 'Unavailable';
    libraryBadge.className = 'library-badge tone-error';
    libraryMessage.textContent = error?.message || 'Could not read the library configuration.';
    libraryMessage.className = 'library-message tone-error';
  } finally {
    setLibraryBusy(false);
  }
}

function setView(view) {
  const isLibrary = view === 'library';
  const isServer = view === 'server';
  checkView.hidden = isLibrary || isServer;
  libraryView.hidden = !isLibrary;
  serverView.hidden = !isServer;
  footerMode.textContent = isLibrary
    ? 'Library configuration'
    : isServer
      ? 'Server control'
      : 'Read-only system check';
  for (const button of viewButtons) {
    const active = button.dataset.view === view;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
    button.disabled = serverActionRunning;
  }
  if (isLibrary) void loadLibraryState();
  if (isServer) renderServerState();
}

async function chooseLibrary() {
  setLibraryBusy(true, 'browse');
  try {
    const path = await bridge()('choose_library_folder');
    if (!path) return;

    selectedPath = path;
    selectedPathIsValid = false;
    selectedLibrary.textContent = path;
    selectedLibrary.classList.remove('is-muted');
    libraryMessage.textContent = 'Checking this folder...';
    libraryMessage.className = 'library-message';

    const result = await bridge()('validate_library_folder', { path });
    selectedPath = result.path || path;
    selectedLibrary.textContent = selectedPath;
    selectedPathIsValid = result.valid;
    libraryMessage.textContent = result.reason;
    libraryMessage.className = `library-message ${result.valid ? 'tone-ready' : 'tone-attention'}`;
  } catch (error) {
    selectedPathIsValid = false;
    libraryMessage.textContent = error?.message || 'Could not validate the selected folder.';
    libraryMessage.className = 'library-message tone-error';
  } finally {
    setLibraryBusy(false);
  }
}

async function applyLibrary() {
  if (!selectedPathIsValid || !selectedPath) return;
  setLibraryBusy(true, 'apply');
  try {
    const result = await bridge()('configure_library', { path: selectedPath });
    renderLibraryState(result);
    if (result.valid) {
      currentLibrary.textContent = result.path;
      selectedPath = '';
      selectedPathIsValid = false;
      selectedLibrary.textContent = 'No new folder selected.';
      selectedLibrary.classList.add('is-muted');
      await refreshChecks();
    }
  } catch (error) {
    libraryMessage.textContent = error?.message || 'Could not save the library configuration.';
    libraryMessage.className = 'library-message tone-error';
  } finally {
    setLibraryBusy(false);
  }
}

function renderServerUnavailable(error) {
  serverBadge.textContent = 'Unavailable';
  serverBadge.className = 'library-badge tone-error';
  serverSummary.textContent = error?.message || 'Could not read Docker or server status.';
  serverChecksList.replaceChildren();
  serverMessage.textContent = 'Refresh checks before running a server action.';
  serverMessage.className = 'library-message tone-error';
  serverActionButton.disabled = true;
}

function renderServerState() {
  if (!latestStatusPayload) {
    renderServerUnavailable();
    return;
  }

  const model = buildServerModel(latestStatusPayload);
  serverBadge.textContent = model.badgeLabel;
  serverBadge.className = `library-badge tone-${model.badgeTone}`;
  serverSummary.textContent = model.summary;
  serverChecksList.replaceChildren(...model.rows.map(renderRow));
  serverActionButton.dataset.action = model.action;
  serverActionButton.textContent = serverActionRunning
    ? model.action === 'restart' ? 'Restarting...' : 'Starting...'
    : model.actionLabel;
  serverActionButton.disabled = serverActionRunning || !model.canRun;

  if (serverActionRunning) {
    serverMessage.textContent = 'Running Docker Compose now. A first build may take a few minutes.';
    serverMessage.className = 'library-message tone-attention';
  } else if (serverActionMessage) {
    serverMessage.textContent = serverActionMessage;
    serverMessage.className = `library-message tone-${serverActionTone}`;
  } else {
    serverMessage.textContent = model.disabledReason || model.actionHint;
    serverMessage.className = `library-message tone-${model.canRun ? 'ready' : 'attention'}`;
  }
}

function setServerActionBusy(isBusy) {
  serverActionRunning = isBusy;
  refreshButton.disabled = isBusy;
  for (const button of viewButtons) {
    button.disabled = isBusy;
  }
  setLibraryBusy(isBusy);
  renderServerState();
}

async function runServerAction() {
  const model = buildServerModel(latestStatusPayload);
  if (!model.canRun || serverActionRunning) return;

  serverActionMessage = '';
  serverActionTone = '';
  setServerActionBusy(true);
  try {
    const result = await bridge()('run_server_action', { action: model.action });
    serverActionMessage = result.reason || 'Server action finished. Setup doctor refreshed.';
    serverActionTone = result.status === 'ready'
      ? 'ready'
      : result.status === 'failed' || result.status === 'unavailable'
        ? 'error'
        : 'attention';
    if (result.statusPayload) {
      renderStatus(result.statusPayload);
    } else {
      await refreshChecks();
    }
  } catch (error) {
    serverActionMessage = error?.message || 'Server action failed.';
    serverActionTone = 'error';
  } finally {
    setServerActionBusy(false);
  }
}

refreshButton.addEventListener('click', refreshChecks);
for (const button of viewButtons) {
  button.addEventListener('click', () => setView(button.dataset.view));
}
browseLibraryButton.addEventListener('click', chooseLibrary);
applyLibraryButton.addEventListener('click', applyLibrary);
serverActionButton.addEventListener('click', runServerAction);
void refreshChecks();
