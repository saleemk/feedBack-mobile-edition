import { buildRenderModel } from './status-model.js';

const refreshButton = document.querySelector('#refresh');
const statusBand = document.querySelector('#status-band');
const overallLabel = document.querySelector('#overall-label');
const overallReason = document.querySelector('#overall-reason');
const generatedAt = document.querySelector('#generated-at');
const checksList = document.querySelector('#checks-list');

function setBusy(isBusy) {
  refreshButton.disabled = isBusy;
  refreshButton.textContent = isBusy ? 'Refreshing...' : 'Refresh checks';
}

function renderError(error) {
  statusBand.className = 'status-band tone-error';
  overallLabel.textContent = 'Setup doctor unavailable';
  overallReason.textContent = error?.message || 'The setup companion could not read the setup doctor.';
  generatedAt.textContent = '';
  checksList.replaceChildren();
}

function renderStatus(payload) {
  const model = buildRenderModel(payload);
  statusBand.className = `status-band tone-${model.overall.tone}`;
  overallLabel.textContent = model.overall.label;
  overallReason.textContent = model.overall.reason;
  generatedAt.textContent = model.generatedAt ? `Checked ${model.generatedAt}` : '';
  checksList.replaceChildren(...model.rows.map(renderRow));
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
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) {
      throw new Error('Tauri bridge is unavailable.');
    }
    renderStatus(await invoke('get_setup_status'));
  } catch (error) {
    renderError(error);
  } finally {
    setBusy(false);
  }
}

refreshButton.addEventListener('click', refreshChecks);
void refreshChecks();
