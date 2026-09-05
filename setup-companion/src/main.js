import { buildDeviceModel, buildRenderModel, buildServerModel, buildWorkflowModel } from './status-model.js';

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
const devicesView = document.querySelector('#devices-view');
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
const serverProgress = document.querySelector('#server-progress');
const serverProgressTitle = document.querySelector('#server-progress-title');
const serverProgressElapsed = document.querySelector('#server-progress-elapsed');
const devicesBadge = document.querySelector('#devices-badge');
const devicesSummary = document.querySelector('#devices-summary-text');
const devicesUrl = document.querySelector('#devices-url');
const devicesChecksList = document.querySelector('#devices-checks-list');
const devicesMessage = document.querySelector('#devices-message');
const devicesActionButton = document.querySelector('#devices-action');

let selectedPath = '';
let selectedPathIsValid = false;
let latestStatusPayload = null;
let initialWorkflowRouteApplied = false;
let actionSequence = 0;
let serverActionRunning = false;
let serverActionKind = '';
let serverActionStartedAt = 0;
let serverActionTimer = 0;
let serverActionMessage = '';
let serverActionTone = '';
let deviceActionRunning = false;
let deviceActionMessage = '';
let deviceActionTone = '';
let prerequisiteActionRunning = false;
let prerequisiteActionView = '';

function setupActionRunning() {
  return serverActionRunning || deviceActionRunning || prerequisiteActionRunning;
}

function bridge() {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) throw new Error('Tauri bridge is unavailable.');
  return invoke;
}

function setBusy(isBusy) {
  refreshButton.disabled = isBusy || setupActionRunning();
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
  renderDevicesUnavailable(error);
}

function routeToWorkflow(workflow, preferredView = '') {
  const view = preferredView || workflow?.view;
  if (!view) return;
  setView(view, { routed: true });
}

function clearActionMessages() {
  serverActionMessage = '';
  serverActionTone = '';
  deviceActionMessage = '';
  deviceActionTone = '';
}

function formatElapsedTime(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function serverActionProgressLabel(action) {
  return action === 'restart' ? 'Restarting Mobile Edition' : 'Starting Mobile Edition';
}

function serverActionButtonLabel(action) {
  return action === 'restart' ? 'Restarting...' : 'Starting...';
}

function prerequisiteActionButtonLabel(action) {
  return action === 'get_docker' || action === 'get_tailscale' || action === 'tailscale_help'
    ? 'Opening guide...'
    : 'Opening...';
}

function renderServerProgress() {
  serverProgress.hidden = !serverActionRunning;
  if (!serverActionRunning) {
    serverProgressTitle.textContent = 'Starting Mobile Edition';
    serverProgressElapsed.textContent = 'Elapsed 0:00';
    return;
  }

  serverProgressTitle.textContent = serverActionProgressLabel(serverActionKind);
  serverProgressElapsed.textContent = `Elapsed ${formatElapsedTime(Date.now() - serverActionStartedAt)}`;
}

function startServerProgress(action) {
  serverActionKind = action;
  serverActionStartedAt = Date.now();
  renderServerProgress();
  window.clearInterval(serverActionTimer);
  serverActionTimer = window.setInterval(renderServerProgress, 1000);
}

function stopServerProgress() {
  window.clearInterval(serverActionTimer);
  serverActionTimer = 0;
  serverActionKind = '';
  serverActionStartedAt = 0;
  renderServerProgress();
}

function renderStatus(payload, options = {}) {
  const { route = false, clearMessages = false, preferredView = '' } = options;
  latestStatusPayload = payload;
  const model = buildRenderModel(payload);
  const workflow = buildWorkflowModel(payload);
  if (clearMessages) clearActionMessages();
  statusBand.className = `status-band tone-${workflow.tone || model.overall.tone}`;
  overallLabel.textContent = workflow.label || model.overall.label;
  overallReason.textContent = workflow.reason || model.overall.reason;
  generatedAt.textContent = model.generatedAt ? `Checked ${model.generatedAt}` : '';
  checksList.replaceChildren(...model.rows.map(renderRow));
  renderServerState();
  renderDevicesState();
  if (route) routeToWorkflow(workflow, preferredView);
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

async function refreshChecks(options = {}) {
  const { route = false, clearMessages = false, preferredView = '' } = options;
  setBusy(true);
  try {
    renderStatus(await bridge()('get_setup_status'), { route, clearMessages, preferredView });
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
  browseLibraryButton.disabled = isBusy || setupActionRunning();
  applyLibraryButton.disabled = isBusy || setupActionRunning() || !selectedPathIsValid;
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

function setView(view, options = {}) {
  const { routed = false } = options;
  const isLibrary = view === 'library';
  const isServer = view === 'server';
  const isDevices = view === 'devices';
  checkView.hidden = isLibrary || isServer || isDevices;
  libraryView.hidden = !isLibrary;
  serverView.hidden = !isServer;
  devicesView.hidden = !isDevices;
  footerMode.textContent = isLibrary
    ? 'Library configuration'
    : isServer
      ? 'Server control'
      : isDevices
        ? 'Device connection'
        : 'Read-only system check';
  for (const button of viewButtons) {
    const active = button.dataset.view === view;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
    button.disabled = setupActionRunning();
  }
  if (routed && !initialWorkflowRouteApplied) {
    initialWorkflowRouteApplied = true;
  }
  if (isLibrary) void loadLibraryState();
  if (isServer) renderServerState();
  if (isDevices) renderDevicesState();
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
      await refreshChecks({ route: true, clearMessages: true, preferredView: 'server' });
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
  serverActionButton.textContent = prerequisiteActionRunning && prerequisiteActionView === 'server'
    ? prerequisiteActionButtonLabel(model.action)
    : serverActionRunning
    ? serverActionButtonLabel(serverActionKind || model.action)
    : model.actionLabel;
  serverActionButton.disabled = setupActionRunning() || !model.canRun;
  renderServerProgress();

  if (prerequisiteActionRunning && prerequisiteActionView === 'server') {
    serverMessage.textContent = 'Opening the selected prerequisite helper. Complete that step, then refresh checks.';
    serverMessage.className = 'library-message tone-attention';
  } else if (serverActionRunning) {
    serverMessage.textContent = 'Running the approved server action now. This can take a few minutes.';
    serverMessage.className = 'library-message tone-attention';
  } else if (serverActionMessage) {
    serverMessage.textContent = serverActionMessage;
    serverMessage.className = `library-message tone-${serverActionTone}`;
  } else {
    serverMessage.textContent = model.disabledReason || model.actionHint;
    serverMessage.className = `library-message tone-${model.canRun ? 'ready' : 'attention'}`;
  }
}

function setServerActionBusy(isBusy, action = '') {
  serverActionRunning = isBusy;
  if (isBusy) {
    startServerProgress(action);
  } else {
    stopServerProgress();
  }
  refreshButton.disabled = setupActionRunning();
  for (const button of viewButtons) {
    button.disabled = setupActionRunning();
  }
  setLibraryBusy(isBusy);
  renderServerState();
  renderDevicesState();
}

function setPrerequisiteActionBusy(isBusy, view = '') {
  prerequisiteActionRunning = isBusy;
  prerequisiteActionView = isBusy ? view : '';
  refreshButton.disabled = setupActionRunning();
  for (const button of viewButtons) {
    button.disabled = setupActionRunning();
  }
  setLibraryBusy(isBusy);
  renderServerState();
  renderDevicesState();
}

async function runPrerequisiteAction(action, view) {
  if (prerequisiteActionRunning || serverActionRunning || deviceActionRunning) return;

  const operation = ++actionSequence;
  if (view === 'server') {
    serverActionMessage = '';
    serverActionTone = '';
  } else {
    deviceActionMessage = '';
    deviceActionTone = '';
  }
  setPrerequisiteActionBusy(true, view);
  try {
    const result = await bridge()('run_prerequisite_action', { action });
    if (operation !== actionSequence) return;
    if (view === 'server') {
      serverActionMessage = result.reason || 'Prerequisite helper opened. Complete that step, then use Refresh checks.';
      serverActionTone = 'attention';
    } else {
      deviceActionMessage = result.reason || 'Prerequisite helper opened. Complete that step, then use Refresh checks.';
      deviceActionTone = 'attention';
    }
  } catch (error) {
    if (operation !== actionSequence) return;
    if (view === 'server') {
      serverActionMessage = error?.message || 'Prerequisite action failed.';
      serverActionTone = 'error';
    } else {
      deviceActionMessage = error?.message || 'Prerequisite action failed.';
      deviceActionTone = 'error';
    }
  } finally {
    if (operation === actionSequence) setPrerequisiteActionBusy(false);
  }
}

async function runServerAction() {
  const model = buildServerModel(latestStatusPayload);
  if (!model.canRun || setupActionRunning()) return;
  if (model.actionKind === 'prerequisite') {
    await runPrerequisiteAction(model.action, 'server');
    return;
  }
  if (model.actionKind !== 'server') return;

  const operation = ++actionSequence;
  serverActionMessage = '';
  serverActionTone = '';
  setServerActionBusy(true, model.action);
  try {
    const result = await bridge()('run_server_action', { action: model.action });
    if (operation !== actionSequence) return;
    serverActionMessage = result.reason || 'Server action finished. Setup doctor refreshed.';
    serverActionTone = result.status === 'ready'
      ? 'ready'
      : result.status === 'failed' || result.status === 'unavailable'
        ? 'error'
        : 'attention';
    if (result.statusPayload) {
      renderStatus(result.statusPayload, { route: true, clearMessages: true });
    } else {
      await refreshChecks({ route: true, clearMessages: true });
    }
  } catch (error) {
    if (operation !== actionSequence) return;
    serverActionMessage = error?.message || 'Server action failed.';
    serverActionTone = 'error';
  } finally {
    if (operation === actionSequence) setServerActionBusy(false);
  }
}

function renderDevicesUnavailable(error) {
  devicesBadge.textContent = 'Unavailable';
  devicesBadge.className = 'library-badge tone-error';
  devicesSummary.textContent = error?.message || 'Could not read device setup status.';
  devicesUrl.textContent = '';
  devicesChecksList.replaceChildren();
  devicesMessage.textContent = 'Refresh checks before running a device action.';
  devicesMessage.className = 'library-message tone-error';
  devicesActionButton.disabled = true;
}

function renderDevicesState() {
  if (!latestStatusPayload) {
    renderDevicesUnavailable();
    return;
  }

  const model = buildDeviceModel(latestStatusPayload);
  devicesBadge.textContent = model.badgeLabel;
  devicesBadge.className = `library-badge tone-${model.badgeTone}`;
  devicesSummary.textContent = model.summary;
  devicesUrl.textContent = model.url;
  devicesChecksList.replaceChildren(...model.rows.map(renderRow));
  devicesActionButton.dataset.action = model.action;
  devicesActionButton.textContent = prerequisiteActionRunning && prerequisiteActionView === 'devices'
    ? prerequisiteActionButtonLabel(model.action)
    : deviceActionRunning
    ? model.action === 'open_guide' ? 'Opening...' : 'Enabling...'
    : model.actionLabel;
  devicesActionButton.disabled = setupActionRunning() || !model.canRun;

  if (prerequisiteActionRunning && prerequisiteActionView === 'devices') {
    devicesMessage.textContent = 'Opening the selected prerequisite helper. Complete that step, then refresh checks.';
    devicesMessage.className = 'library-message tone-attention';
  } else if (deviceActionRunning) {
    devicesMessage.textContent = model.action === 'open_guide'
      ? 'Creating and opening the local QR guide.'
      : 'Configuring private HTTPS with Tailscale Serve.';
    devicesMessage.className = 'library-message tone-attention';
  } else if (deviceActionMessage) {
    devicesMessage.textContent = deviceActionMessage;
    devicesMessage.className = `library-message tone-${deviceActionTone}`;
  } else {
    devicesMessage.textContent = model.disabledReason || model.actionHint;
    devicesMessage.className = `library-message tone-${model.canRun ? 'ready' : 'attention'}`;
  }
}

function setDeviceActionBusy(isBusy) {
  deviceActionRunning = isBusy;
  refreshButton.disabled = setupActionRunning();
  for (const button of viewButtons) {
    button.disabled = setupActionRunning();
  }
  setLibraryBusy(isBusy);
  renderServerState();
  renderDevicesState();
}

async function runDeviceAction() {
  const model = buildDeviceModel(latestStatusPayload);
  if (!model.canRun || setupActionRunning()) return;
  if (model.actionKind === 'prerequisite') {
    await runPrerequisiteAction(model.action, 'devices');
    return;
  }
  if (model.actionKind !== 'device') return;

  const operation = ++actionSequence;
  deviceActionMessage = '';
  deviceActionTone = '';
  setDeviceActionBusy(true);
  try {
    const result = await bridge()('run_device_action', { action: model.action });
    if (operation !== actionSequence) return;
    deviceActionMessage = result.reason || 'Device action finished. Setup doctor refreshed.';
    deviceActionTone = result.status === 'ready'
      ? 'ready'
      : result.status === 'failed' || result.status === 'conflict' || result.status === 'unavailable'
        ? 'error'
        : 'attention';
    if (result.statusPayload) {
      renderStatus(result.statusPayload, { route: true, clearMessages: true });
    } else {
      await refreshChecks({ route: true, clearMessages: true });
    }
  } catch (error) {
    if (operation !== actionSequence) return;
    deviceActionMessage = error?.message || 'Device action failed.';
    deviceActionTone = 'error';
  } finally {
    if (operation === actionSequence) setDeviceActionBusy(false);
  }
}

refreshButton.addEventListener('click', () => refreshChecks({ route: !initialWorkflowRouteApplied, clearMessages: true }));
for (const button of viewButtons) {
  button.addEventListener('click', () => setView(button.dataset.view));
}
browseLibraryButton.addEventListener('click', chooseLibrary);
applyLibraryButton.addEventListener('click', applyLibrary);
serverActionButton.addEventListener('click', runServerAction);
devicesActionButton.addEventListener('click', runDeviceAction);
void refreshChecks({ route: true, clearMessages: true });
