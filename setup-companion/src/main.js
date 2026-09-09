import { buildCheckActionModel, buildDeviceModel, buildRenderModel, buildServerModel, buildWorkflowModel } from './status-model.js';
import {
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
} from './update-model.js';
import {
  PREREQUISITE_WAIT_INTERVAL_MS,
  buildPrerequisiteCompleteMessage,
  buildPrerequisiteTimeoutMessage,
  buildPrerequisiteWaitMessage,
  canStartPrerequisitePoll,
  createPrerequisiteWait,
  hasPrerequisiteWaitTimedOut,
  shouldStartPrerequisiteWait,
  shouldCompletePrerequisiteWait,
} from './wait-policy.js';

const refreshButton = document.querySelector('#refresh');
const statusBand = document.querySelector('#status-band');
const overallLabel = document.querySelector('#overall-label');
const overallReason = document.querySelector('#overall-reason');
const checkActionRow = document.querySelector('#check-action-row');
const checkActionButton = document.querySelector('#check-action');
const checkActionMessage = document.querySelector('#check-action-message');
const updateStatus = document.querySelector('#update-status');
const updateHeading = document.querySelector('#update-heading');
const updateSummary = document.querySelector('#update-summary');
const updateVersions = document.querySelector('#update-versions');
const reviewUpdateButton = document.querySelector('#review-update');
const downloadUpdateButton = document.querySelector('#download-update');
const installUpdateButton = document.querySelector('#install-update');
const openUpdateButton = document.querySelector('#open-update');
const defaultVersionField = document.querySelector('#default-version-field');
const defaultVersionSelect = document.querySelector('#default-version-select');
const saveDefaultVersionButton = document.querySelector('#save-default-version');
const updateProgress = document.querySelector('#update-progress');
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
let deviceActionView = '';
let checkDeviceActionMessage = '';
let checkDeviceActionTone = '';
let deviceActionMessage = '';
let deviceActionTone = '';
let prerequisiteActionRunning = false;
let prerequisiteActionView = '';
let prerequisiteWait = null;
let prerequisiteWaitTimer = 0;
let updateSequence = 0;
let updateActionSequence = 0;
let currentUpdateModel = buildCheckingUpdateModel();
let updateActionRunning = false;
let updateStageRunning = false;
let updateInstallRunning = false;
let updateOpenRunning = false;
let updateDefaultVersionRunning = false;
let updateActionMessage = '';
let updateActionTone = '';
let updateProgressText = '';
let selectedDefaultVersionValue = null;

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
  renderCheckActionUnavailable();
  generatedAt.textContent = '';
  checksList.replaceChildren();
  renderServerUnavailable(error);
  renderDevicesUnavailable(error);
}

function renderUpdateStatus(model) {
  currentUpdateModel = model;
  updateStatus.className = `status-update tone-${model.tone || 'attention'}`;
  updateHeading.textContent = model.label;
  updateSummary.textContent = updateActionMessage || model.summary;
  updateSummary.className = updateActionTone ? `tone-${updateActionTone}` : '';
  const versions = [];
  if (model.localVersion) versions.push(`Local ${model.localVersion}`);
  if (model.latestVersion) versions.push(`Latest stable ${model.latestVersion}`);
  updateVersions.textContent = versions.join(' / ');
  renderUpdateActions();
}

function applyLocalSetupBundleState(model, activationState, versionInventory) {
  return applySetupBundleVersionInventory(
    applySetupBundleActivationState(model, activationState),
    versionInventory,
  );
}

async function refreshLocalSetupBundleState(model = currentUpdateModel) {
  const [activationState, versionInventory] = await Promise.all([
    bridge()('get_setup_bundle_activation_state').catch(() => null),
    bridge()('get_setup_bundle_version_inventory').catch(() => null),
  ]);
  return applyLocalSetupBundleState(model, activationState, versionInventory);
}

function renderDefaultVersionSelect(action, updateBusy) {
  defaultVersionField.hidden = !action.visible;
  defaultVersionSelect.disabled = updateBusy || !action.visible;
  defaultVersionSelect.replaceChildren();
  if (!action.selectedValue) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose version';
    defaultVersionSelect.append(placeholder);
  }
  for (const entry of action.options) {
    const option = document.createElement('option');
    option.value = entry.value;
    option.textContent = entry.label;
    defaultVersionSelect.append(option);
  }
  defaultVersionSelect.value = action.selectedValue;
  selectedDefaultVersionValue = action.selectedValue || null;
}

function renderUpdateActions() {
  const reviewAction = buildReviewUpdateActionModel(currentUpdateModel);
  const stageAction = buildStageSetupBundleUpdateActionModel(currentUpdateModel);
  const installAction = buildInstallSetupBundleUpdateActionModel(currentUpdateModel);
  const openAction = buildOpenInstalledSetupBundleUpdateActionModel(currentUpdateModel);
  const defaultVersionAction = buildDefaultVersionActionModel(currentUpdateModel, selectedDefaultVersionValue);
  const updateBusy = updateActionRunning
    || updateStageRunning
    || updateInstallRunning
    || updateOpenRunning
    || updateDefaultVersionRunning;

  reviewUpdateButton.hidden = !reviewAction.visible;
  reviewUpdateButton.disabled = updateBusy || !reviewAction.canRun;
  reviewUpdateButton.dataset.latestTag = reviewAction.tag;
  reviewUpdateButton.textContent = updateActionRunning ? 'Opening...' : reviewAction.label;

  downloadUpdateButton.hidden = !(stageAction.visible || updateStageRunning);
  downloadUpdateButton.disabled = updateBusy || !stageAction.canRun;
  downloadUpdateButton.dataset.latestTag = stageAction.tag;
  downloadUpdateButton.textContent = updateStageRunning ? 'Downloading...' : stageAction.label;

  installUpdateButton.hidden = !(installAction.visible || updateInstallRunning);
  installUpdateButton.disabled = updateBusy || !installAction.canRun;
  installUpdateButton.dataset.latestTag = installAction.tag;
  installUpdateButton.textContent = updateInstallRunning ? 'Installing...' : installAction.label;

  openUpdateButton.hidden = !(openAction.visible || updateOpenRunning);
  openUpdateButton.disabled = updateBusy || !openAction.canRun;
  openUpdateButton.dataset.latestTag = openAction.tag;
  openUpdateButton.textContent = updateOpenRunning ? 'Trying...' : openAction.label;

  renderDefaultVersionSelect(defaultVersionAction, updateBusy);
  saveDefaultVersionButton.hidden = !(defaultVersionAction.visible || updateDefaultVersionRunning);
  saveDefaultVersionButton.disabled = updateBusy || !defaultVersionAction.canRun;
  saveDefaultVersionButton.dataset.defaultVersion = defaultVersionAction.selectedValue;
  saveDefaultVersionButton.textContent = updateDefaultVersionRunning ? 'Saving...' : defaultVersionAction.label;

  updateSummary.textContent = updateActionMessage || currentUpdateModel.summary;
  updateSummary.className = updateActionTone ? `tone-${updateActionTone}` : '';
  updateProgress.textContent = updateProgressText;
  updateProgress.hidden = !updateProgressText;
}

async function refreshUpdateStatus() {
  const sequence = ++updateSequence;
  if (!updateStageRunning && !updateInstallRunning && !updateOpenRunning && !updateDefaultVersionRunning) {
    updateActionMessage = '';
    updateActionTone = '';
    updateProgressText = '';
  }
  renderUpdateStatus(buildCheckingUpdateModel());
  try {
    const localIdentity = await bridge()('get_update_identity');
    let activationState = null;
    let versionInventory = null;
    const activationStatePromise = localIdentity?.source === 'setup_bundle'
      ? Promise.all([
        bridge()('get_setup_bundle_activation_state').catch(() => null),
        bridge()('get_setup_bundle_version_inventory').catch(() => null),
      ])
        .then(([activation, inventory]) => {
          activationState = activation;
          versionInventory = inventory;
          if (sequence === updateSequence) {
            const localModel = buildUpdateStatusModel(localIdentity, null);
            renderUpdateStatus(applyLocalSetupBundleState(localModel, activation, inventory));
          }
          return { activationState: activation, versionInventory: inventory };
        })
      : Promise.resolve({ activationState: null, versionInventory: null });
    let model = await checkLatestStableRelease(localIdentity, {
      fetchImpl: window.fetch?.bind(window) || globalThis.fetch,
      AbortControllerImpl: window.AbortController || globalThis.AbortController,
    });
    if (model.state === 'available' && model.localSource === 'setup_bundle' && model.latestTag) {
      try {
        const installState = await bridge()('get_setup_bundle_update_state', { tag: model.latestTag });
        model = applySetupBundleUpdateState(model, installState);
      } catch (_error) {
        // A failed local state check should not hide the already safe review/download path.
      }
    }
    const localState = await activationStatePromise;
    activationState = activationState || localState?.activationState;
    versionInventory = versionInventory || localState?.versionInventory;
    model = applyLocalSetupBundleState(model, activationState, versionInventory);
    if (sequence === updateSequence) renderUpdateStatus(model);
  } catch (error) {
    if (sequence === updateSequence) {
      renderUpdateStatus({
        state: 'unavailable',
        tone: 'attention',
        label: "Couldn't check",
        summary: error?.message || 'The latest stable release could not be checked.',
        localVersion: '',
        latestVersion: '',
        latestTag: '',
      });
    }
  }
}

function setUpdateActionBusy(isBusy) {
  updateActionRunning = isBusy;
  renderUpdateActions();
}

function setUpdateStageBusy(isBusy) {
  updateStageRunning = isBusy;
  renderUpdateActions();
}

function setUpdateInstallBusy(isBusy) {
  updateInstallRunning = isBusy;
  renderUpdateActions();
}

function setUpdateOpenBusy(isBusy) {
  updateOpenRunning = isBusy;
  renderUpdateActions();
}

function setUpdateDefaultVersionBusy(isBusy) {
  updateDefaultVersionRunning = isBusy;
  renderUpdateActions();
}

async function reviewAvailableUpdate() {
  const action = buildReviewUpdateActionModel(currentUpdateModel);
  if (updateActionRunning || !action.canRun) return;

  const operation = ++updateActionSequence;
  updateActionMessage = '';
  updateActionTone = '';
  setUpdateActionBusy(true);
  try {
    const result = await bridge()('review_available_update', { tag: action.tag });
    if (operation !== updateActionSequence) return;
    updateActionMessage = 'Release page opened.';
    updateActionTone = 'ready';
  } catch (error) {
    if (operation !== updateActionSequence) return;
    updateActionMessage = 'Could not open release page.';
    updateActionTone = 'error';
  } finally {
    if (operation === updateActionSequence) setUpdateActionBusy(false);
  }
}

function formatUpdateBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function updateProgressLabel(progress) {
  const downloaded = Number(progress?.bytesDownloaded || 0);
  const total = Number(progress?.bytesTotal || 0);
  if (total > 0) {
    const percent = Math.min(100, Math.floor((downloaded / total) * 100));
    return `${formatUpdateBytes(downloaded)} / ${formatUpdateBytes(total)} (${percent}%)`;
  }
  return downloaded > 0 ? formatUpdateBytes(downloaded) : '';
}

function renderUpdateStageProgress(progress) {
  if (!updateStageRunning) return;
  const stageAction = buildStageSetupBundleUpdateActionModel(currentUpdateModel);
  if (stageAction.tag && progress?.tag && progress.tag !== stageAction.tag) return;
  updateActionMessage = progress?.label || 'Downloading update';
  updateActionTone = 'attention';
  updateProgressText = updateProgressLabel(progress);
  renderUpdateActions();
}

function renderUpdateInstallProgress(progress) {
  if (!updateInstallRunning) return;
  const installAction = buildInstallSetupBundleUpdateActionModel(currentUpdateModel);
  if (installAction.tag && progress?.tag && progress.tag !== installAction.tag) return;
  updateActionMessage = progress?.label || 'Installing update';
  updateActionTone = 'attention';
  updateProgressText = updateProgressLabel({
    bytesDownloaded: progress?.bytesProcessed,
    bytesTotal: progress?.bytesTotal,
  });
  renderUpdateActions();
}

function updateStageFailureMessage(error) {
  const code = error?.code || '';
  if (code.includes('download') || code.includes('overflow')) return 'Download failed. Retry update.';
  if (code.includes('checksum') || code.includes('verification') || code.includes('cache_read')) {
    return 'Verification failed. Retry update.';
  }
  return 'Could not stage update.';
}

function updateInstallFailureMessage(error) {
  const code = error?.code || '';
  if (code.includes('conflict')) return 'Installation conflict. Review update.';
  if (code.includes('cache') || code.includes('verification')) return 'Verification failed. Retry update.';
  if (code.includes('archive') || code.includes('install')) return 'Installation failed. Retry update.';
  return 'Could not install update.';
}

function updateOpenFailureMessage(error) {
  const code = error?.code || '';
  if (code.includes('launch')) return 'Could not try new version.';
  if (code.includes('install')) return 'Installed update could not be verified.';
  return 'Could not try new version.';
}

async function stageSetupBundleUpdate() {
  const action = buildStageSetupBundleUpdateActionModel(currentUpdateModel);
  if (updateStageRunning || updateInstallRunning || updateOpenRunning || updateDefaultVersionRunning || updateActionRunning || !action.canRun) return;

  const operation = ++updateActionSequence;
  updateActionMessage = 'Downloading update';
  updateActionTone = 'attention';
  updateProgressText = '';
  setUpdateStageBusy(true);
  try {
    const result = await bridge()('stage_setup_bundle_update', { tag: action.tag });
    if (operation !== updateActionSequence) return;
    updateActionMessage = result?.phase === 'cached'
      ? 'Cached update verified for later install.'
      : 'Verified update ready for later install.';
    updateActionTone = 'ready';
    updateProgressText = '';
    currentUpdateModel = applySetupBundleUpdateState(currentUpdateModel, {
      status: 'downloaded',
      tag: action.tag,
    });
  } catch (error) {
    if (operation !== updateActionSequence) return;
    updateActionMessage = updateStageFailureMessage(error);
    updateActionTone = 'error';
    updateProgressText = '';
  } finally {
    if (operation === updateActionSequence) setUpdateStageBusy(false);
  }
}

async function installSetupBundleUpdate() {
  const action = buildInstallSetupBundleUpdateActionModel(currentUpdateModel);
  if (updateStageRunning || updateInstallRunning || updateOpenRunning || updateDefaultVersionRunning || updateActionRunning || !action.canRun) return;

  const operation = ++updateActionSequence;
  updateActionMessage = 'Installing update';
  updateActionTone = 'attention';
  updateProgressText = '';
  setUpdateInstallBusy(true);
  try {
    await bridge()('install_setup_bundle_update', { tag: action.tag });
    if (operation !== updateActionSequence) return;
    currentUpdateModel = applySetupBundleUpdateState(currentUpdateModel, {
      status: 'installed',
      tag: action.tag,
    });
    updateActionMessage = 'Update installed. Try when ready.';
    updateActionTone = 'ready';
    updateProgressText = '';
  } catch (error) {
    if (operation !== updateActionSequence) return;
    updateActionMessage = updateInstallFailureMessage(error);
    updateActionTone = 'error';
    updateProgressText = '';
  } finally {
    if (operation === updateActionSequence) setUpdateInstallBusy(false);
  }
}

async function openInstalledSetupBundleUpdate() {
  const action = buildOpenInstalledSetupBundleUpdateActionModel(currentUpdateModel);
  if (updateStageRunning || updateInstallRunning || updateOpenRunning || updateDefaultVersionRunning || updateActionRunning || !action.canRun) return;

  const operation = ++updateActionSequence;
  updateActionMessage = 'Trying new version';
  updateActionTone = 'attention';
  updateProgressText = '';
  setUpdateOpenBusy(true);
  try {
    await bridge()('open_installed_setup_bundle_update', { tag: action.tag });
    if (operation !== updateActionSequence) return;
    updateActionMessage = 'New version opened for this session.';
    updateActionTone = 'ready';
  } catch (error) {
    if (operation !== updateActionSequence) return;
    updateActionMessage = updateOpenFailureMessage(error);
    updateActionTone = 'error';
  } finally {
    if (operation === updateActionSequence) setUpdateOpenBusy(false);
  }
}

async function saveDefaultSetupVersion() {
  const action = buildDefaultVersionActionModel(currentUpdateModel, selectedDefaultVersionValue);
  if (updateStageRunning || updateInstallRunning || updateOpenRunning || updateDefaultVersionRunning || updateActionRunning || !action.canRun) return;

  const operation = ++updateActionSequence;
  updateActionMessage = 'Saving default version';
  updateActionTone = 'attention';
  updateProgressText = '';
  setUpdateDefaultVersionBusy(true);
  try {
    if (action.selectedValue === ORIGINAL_SETUP_VERSION_VALUE) {
      await bridge()('restore_bundled_setup_current');
    } else {
      await bridge()('select_setup_bundle_version_current', { tag: action.selectedValue });
    }
    if (operation !== updateActionSequence) return;
    const settledModel = await refreshLocalSetupBundleState(currentUpdateModel);
    if (operation !== updateActionSequence) return;
    currentUpdateModel = settledModel;
    selectedDefaultVersionValue = null;
    const savedLabel = action.selectedValue === ORIGINAL_SETUP_VERSION_VALUE
      ? 'Original setup version'
      : action.selectedValue;
    updateActionMessage = `Default saved. Opens next time: ${savedLabel}.`;
    updateActionTone = 'ready';
    renderUpdateStatus(currentUpdateModel);
  } catch (error) {
    if (operation !== updateActionSequence) return;
    updateActionMessage = 'Could not save default version.';
    updateActionTone = 'error';
  } finally {
    if (operation === updateActionSequence) setUpdateDefaultVersionBusy(false);
  }
}

function routeToWorkflow(workflow, preferredView = '') {
  const view = preferredView || workflow?.view;
  if (!view) return;
  setView(view, { routed: true });
}

function clearActionMessages() {
  checkDeviceActionMessage = '';
  checkDeviceActionTone = '';
  serverActionMessage = '';
  serverActionTone = '';
  deviceActionMessage = '';
  deviceActionTone = '';
}

function setActionMessage(view, message, tone = 'attention') {
  if (view === 'check') {
    checkDeviceActionMessage = message;
    checkDeviceActionTone = tone;
  } else if (view === 'server') {
    serverActionMessage = message;
    serverActionTone = tone;
  } else if (view === 'devices') {
    deviceActionMessage = message;
    deviceActionTone = tone;
  }
}

function modelForView(view, payload = latestStatusPayload) {
  if (view === 'check') return buildCheckActionModel(payload);
  if (view === 'server') return buildServerModel(payload);
  if (view === 'devices') return buildDeviceModel(payload);
  return null;
}

function isWatchedPrerequisite(view, model) {
  return Boolean(prerequisiteWait)
    && prerequisiteWait.view === view
    && model?.actionKind === 'prerequisite'
    && model.action === prerequisiteWait.action;
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

function clearPrerequisiteWait() {
  window.clearTimeout(prerequisiteWaitTimer);
  prerequisiteWaitTimer = 0;
  prerequisiteWait = null;
}

function cancelPrerequisiteWait() {
  if (!prerequisiteWait) return;
  clearPrerequisiteWait();
  renderServerState();
  renderDevicesState();
}

function finishPrerequisiteWait(status, model = null) {
  const wait = prerequisiteWait;
  if (!wait) return;
  clearPrerequisiteWait();
  refreshButton.disabled = setupActionRunning();
  refreshButton.textContent = 'Refresh checks';
  if (status === 'complete') {
    setActionMessage(wait.view, buildPrerequisiteCompleteMessage(wait, model), 'attention');
  } else if (status === 'timeout') {
    setActionMessage(wait.view, buildPrerequisiteTimeoutMessage(wait), 'attention');
  }
  renderServerState();
  renderDevicesState();
}

function schedulePrerequisitePoll(delay = PREREQUISITE_WAIT_INTERVAL_MS) {
  window.clearTimeout(prerequisiteWaitTimer);
  if (!prerequisiteWait) return;
  prerequisiteWaitTimer = window.setTimeout(() => {
    void pollPrerequisiteWait();
  }, delay);
}

async function pollPrerequisiteWait() {
  const wait = prerequisiteWait;
  if (!canStartPrerequisitePoll(wait)) return;

  wait.pollInFlight = true;
  refreshButton.disabled = true;
  refreshButton.textContent = 'Checking...';
  renderServerState();
  renderDevicesState();
  try {
    const payload = await bridge()('get_setup_status');
    if (prerequisiteWait !== wait) return;
    wait.lastError = '';
    renderStatus(payload, { route: false, clearMessages: false });
    const currentModel = modelForView(wait.view, payload);
    if (shouldCompletePrerequisiteWait(wait, currentModel)) {
      finishPrerequisiteWait('complete', currentModel);
      return;
    }
  } catch (error) {
    if (prerequisiteWait !== wait) return;
    wait.lastError = error?.message || 'Setup doctor check failed.';
  } finally {
    if (prerequisiteWait === wait) {
      wait.pollInFlight = false;
      refreshButton.disabled = false;
      refreshButton.textContent = 'Refresh checks';
      if (hasPrerequisiteWaitTimedOut(wait)) {
        finishPrerequisiteWait('timeout');
      } else {
        renderServerState();
        renderDevicesState();
        schedulePrerequisitePoll();
      }
    }
  }
}

function startPrerequisiteWait(view, action, label) {
  clearPrerequisiteWait();
  prerequisiteWait = createPrerequisiteWait({ view, action, label });
  renderServerState();
  renderDevicesState();
  schedulePrerequisitePoll();
}

function checkActionButtonLabel(action) {
  return action === 'open_guide' ? 'Opening...' : 'Working...';
}

function renderCheckActionUnavailable() {
  checkActionRow.hidden = true;
  checkActionButton.disabled = true;
  checkActionButton.dataset.action = 'none';
  checkActionButton.textContent = 'Connect phone / tablet';
  checkActionMessage.textContent = '';
  checkActionMessage.className = '';
  checkActionMessage.hidden = true;
}

function renderCheckActionState() {
  if (!latestStatusPayload) {
    renderCheckActionUnavailable();
    return;
  }

  const model = buildCheckActionModel(latestStatusPayload);
  const shouldShow = model.visible || (deviceActionRunning && deviceActionView === 'check') || Boolean(checkDeviceActionMessage);
  checkActionRow.hidden = !shouldShow;
  checkActionButton.dataset.action = model.action;
  checkActionButton.textContent = deviceActionRunning && deviceActionView === 'check'
    ? checkActionButtonLabel(model.action)
    : model.actionLabel;
  checkActionButton.disabled = setupActionRunning() || !model.canRun;

  if (deviceActionRunning && deviceActionView === 'check') {
    checkActionMessage.textContent = 'Creating and opening the local QR guide.';
    checkActionMessage.className = 'tone-attention';
    checkActionMessage.hidden = false;
  } else if (checkDeviceActionMessage) {
    checkActionMessage.textContent = checkDeviceActionMessage;
    checkActionMessage.className = checkDeviceActionTone ? `tone-${checkDeviceActionTone}` : '';
    checkActionMessage.hidden = false;
  } else {
    checkActionMessage.textContent = '';
    checkActionMessage.className = '';
    checkActionMessage.hidden = true;
  }
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
  renderCheckActionState();
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
  void refreshUpdateStatus();
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
  libraryMessage.textContent = 'Saving this library and checking the next setup step...';
  libraryMessage.className = 'library-message tone-attention';
  try {
    const result = await bridge()('configure_library', { path: selectedPath });
    renderLibraryState(result);
    if (result.valid) {
      currentLibrary.textContent = result.path;
      selectedPath = '';
      selectedPathIsValid = false;
      selectedLibrary.textContent = 'No new folder selected.';
      selectedLibrary.classList.add('is-muted');
      libraryMessage.textContent = 'Library saved. Checking the server step...';
      libraryMessage.className = 'library-message tone-attention';
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
  serverActionButton.disabled = setupActionRunning() || !model.canRun || isWatchedPrerequisite('server', model);
  renderServerProgress();

  if (prerequisiteWait?.view === 'server') {
    serverMessage.textContent = buildPrerequisiteWaitMessage(prerequisiteWait);
    serverMessage.className = 'library-message tone-attention';
  } else if (prerequisiteActionRunning && prerequisiteActionView === 'server') {
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
  renderCheckActionState();
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
  renderCheckActionState();
  renderServerState();
  renderDevicesState();
}

async function runPrerequisiteAction(action, view) {
  if (prerequisiteActionRunning || serverActionRunning || deviceActionRunning) return;

  const operation = ++actionSequence;
  cancelPrerequisiteWait();
  const model = modelForView(view);
  const label = model?.actionLabel || 'prerequisite';
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
    if (shouldStartPrerequisiteWait(result)) {
      startPrerequisiteWait(view, action, label);
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
  if (isWatchedPrerequisite('server', model)) return;
  if (model.actionKind === 'prerequisite') {
    await runPrerequisiteAction(model.action, 'server');
    return;
  }
  if (model.actionKind !== 'server') return;
  cancelPrerequisiteWait();

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
  devicesActionButton.disabled = setupActionRunning() || !model.canRun || isWatchedPrerequisite('devices', model);

  if (prerequisiteWait?.view === 'devices') {
    devicesMessage.textContent = buildPrerequisiteWaitMessage(prerequisiteWait);
    devicesMessage.className = 'library-message tone-attention';
  } else if (prerequisiteActionRunning && prerequisiteActionView === 'devices') {
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

function setDeviceActionBusy(isBusy, view = '') {
  deviceActionRunning = isBusy;
  deviceActionView = isBusy ? view : '';
  refreshButton.disabled = setupActionRunning();
  for (const button of viewButtons) {
    button.disabled = setupActionRunning();
  }
  setLibraryBusy(isBusy);
  renderCheckActionState();
  renderServerState();
  renderDevicesState();
}

async function runDeviceAction(view = 'devices') {
  const model = view === 'check'
    ? buildCheckActionModel(latestStatusPayload)
    : buildDeviceModel(latestStatusPayload);
  if (!model.canRun || setupActionRunning()) return;
  if (view === 'devices' && isWatchedPrerequisite('devices', model)) return;
  if (model.actionKind === 'prerequisite') {
    await runPrerequisiteAction(model.action, 'devices');
    return;
  }
  if (model.actionKind !== 'device') return;
  cancelPrerequisiteWait();

  const operation = ++actionSequence;
  setActionMessage(view, '', '');
  setDeviceActionBusy(true, view);
  try {
    const result = await bridge()('run_device_action', { action: model.action });
    if (operation !== actionSequence) return;
    const tone = result.status === 'ready'
      ? 'ready'
      : result.status === 'failed' || result.status === 'conflict' || result.status === 'unavailable'
        ? 'error'
        : 'attention';
    setActionMessage(view, result.reason || 'Device action finished. Setup doctor refreshed.', tone);
    if (result.statusPayload) {
      renderStatus(result.statusPayload, { route: view !== 'check', clearMessages: false });
    } else {
      await refreshChecks({ route: view !== 'check', clearMessages: false });
    }
  } catch (error) {
    if (operation !== actionSequence) return;
    setActionMessage(view, error?.message || 'Device action failed.', 'error');
  } finally {
    if (operation === actionSequence) setDeviceActionBusy(false, view);
  }
}

refreshButton.addEventListener('click', () => {
  if (prerequisiteWait) {
    void pollPrerequisiteWait();
  } else {
    void refreshChecks({ route: !initialWorkflowRouteApplied, clearMessages: true });
  }
});
for (const button of viewButtons) {
  button.addEventListener('click', () => setView(button.dataset.view));
}
browseLibraryButton.addEventListener('click', chooseLibrary);
applyLibraryButton.addEventListener('click', applyLibrary);
serverActionButton.addEventListener('click', runServerAction);
checkActionButton.addEventListener('click', () => {
  void runDeviceAction('check');
});
reviewUpdateButton.addEventListener('click', () => {
  void reviewAvailableUpdate();
});
devicesActionButton.addEventListener('click', () => {
  void runDeviceAction('devices');
});
downloadUpdateButton.addEventListener('click', () => {
  void stageSetupBundleUpdate();
});
installUpdateButton.addEventListener('click', () => {
  void installSetupBundleUpdate();
});
openUpdateButton.addEventListener('click', () => {
  void openInstalledSetupBundleUpdate();
});
defaultVersionSelect.addEventListener('change', () => {
  selectedDefaultVersionValue = defaultVersionSelect.value;
  renderUpdateActions();
});
saveDefaultVersionButton.addEventListener('click', () => {
  void saveDefaultSetupVersion();
});
window.__TAURI__?.event?.listen?.('setup-bundle-update-progress', (event) => {
  renderUpdateStageProgress(event?.payload);
});
window.__TAURI__?.event?.listen?.('setup-bundle-install-progress', (event) => {
  renderUpdateInstallProgress(event?.payload);
});
window.addEventListener('beforeunload', clearPrerequisiteWait);
void refreshChecks({ route: true, clearMessages: true });
