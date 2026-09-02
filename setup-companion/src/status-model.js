const CHECK_ORDER = [
  ['repository', 'Repository configuration'],
  ['docker', 'Docker and Compose'],
  ['server', 'Edition server'],
  ['tailscale', 'Tailscale'],
  ['privateHttps', 'Private HTTPS access'],
];

const STATUS_LABELS = {
  ready: 'Ready',
  needs_action: 'Needs action',
  unavailable: 'Unavailable',
  blocked: 'Needs action',
  local_ready_mobile_setup_remaining: 'Needs action',
};

const SERVER_ROW_KEYS = ['docker', 'server'];
const DEVICE_ROW_KEYS = ['server', 'tailscale', 'privateHttps'];

function toneForStatus(status) {
  if (status === 'ready') return 'ready';
  if (status === 'needs_action' || status === 'local_ready_mobile_setup_remaining') return 'attention';
  if (status === 'unavailable' || status === 'blocked') return 'error';
  return 'neutral';
}

function labelForStatus(status) {
  return STATUS_LABELS[status] || status || 'Unknown';
}

function rowsFromReport(report) {
  return CHECK_ORDER.map(([key, label]) => {
    const check = report?.checks?.[key] || {};
    return {
      key,
      label,
      status: check.status || 'unknown',
      reason: check.reason || 'No status details returned.',
      nextAction: check.nextAction || '',
      url: check.url || '',
    };
  });
}

export function formatGeneratedAt(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function buildRenderModel(payload) {
  const report = payload?.report || payload || {};
  const rows = Array.isArray(payload?.rows) && payload.rows.length > 0
    ? payload.rows
    : rowsFromReport(report);
  const overall = report.overall || {};

  return {
    generatedAt: formatGeneratedAt(report.generatedAt || payload?.generatedAt),
    overall: {
      status: overall.status || 'unknown',
      tone: toneForStatus(overall.status),
      label: labelForStatus(overall.status),
      reason: overall.reason || 'No overall setup result returned.',
    },
    rows: rows.map((row) => ({
      key: row.key,
      label: row.label,
      status: row.status,
      statusLabel: labelForStatus(row.status),
      tone: toneForStatus(row.status),
      reason: row.reason || 'No status details returned.',
      nextAction: row.nextAction || '',
      url: row.url || '',
    })),
  };
}

export function buildServerModel(payload) {
  const model = buildRenderModel(payload);
  const rowsByKey = new Map(model.rows.map((row) => [row.key, row]));
  const repository = rowsByKey.get('repository') || {};
  const docker = rowsByKey.get('docker') || {};
  const server = rowsByKey.get('server') || {};
  const serverReady = server.status === 'ready';
  const action = serverReady ? 'restart' : 'start';

  let disabledReason = '';
  if (repository.status !== 'ready') {
    disabledReason = 'Finish library configuration before starting the server.';
  } else if (docker.status === 'unavailable') {
    disabledReason = docker.reason || 'Docker is unavailable.';
  }

  const actionHint = serverReady
    ? 'Restart only the Mobile Edition web service.'
    : 'Start the Mobile Edition release stack. The first build may take a few minutes.';

  return {
    action,
    actionLabel: serverReady ? 'Restart server' : 'Start server',
    canRun: !disabledReason,
    disabledReason,
    actionHint,
    badgeLabel: serverReady ? 'Server ready' : 'Server not ready',
    badgeTone: serverReady ? 'ready' : 'attention',
    summary: server.reason || 'No local server status returned.',
    rows: SERVER_ROW_KEYS.map((key) => rowsByKey.get(key)).filter(Boolean),
  };
}

export function buildDeviceModel(payload) {
  const model = buildRenderModel(payload);
  const rowsByKey = new Map(model.rows.map((row) => [row.key, row]));
  const server = rowsByKey.get('server') || {};
  const tailscale = rowsByKey.get('tailscale') || {};
  const privateHttps = rowsByKey.get('privateHttps') || {};
  const privateHttpsReady = privateHttps.status === 'ready' && Boolean(privateHttps.url);
  const action = privateHttpsReady ? 'open_guide' : 'enable_https';

  let disabledReason = '';
  if (server.status !== 'ready') {
    disabledReason = server.reason || 'Start the local server before connecting devices.';
  } else if (tailscale.status !== 'ready') {
    disabledReason = tailscale.reason || 'Tailscale must be ready before private HTTPS can be configured.';
  } else if (privateHttps.status === 'ready' && !privateHttps.url) {
    disabledReason = 'Private HTTPS is ready, but the setup doctor did not return a URL.';
  }

  const actionHint = privateHttpsReady
    ? 'Create and open the local phone/tablet QR guide.'
    : 'Enable the existing guarded Tailscale Serve HTTPS path for this configured port.';

  return {
    action,
    actionLabel: privateHttpsReady ? 'Open device guide' : 'Enable private HTTPS',
    canRun: !disabledReason,
    disabledReason,
    actionHint,
    badgeLabel: privateHttpsReady ? 'Devices ready' : 'Devices need setup',
    badgeTone: privateHttpsReady ? 'ready' : 'attention',
    summary: privateHttpsReady
      ? 'Private HTTPS is ready for phones and tablets.'
      : privateHttps.reason || 'Private HTTPS is not ready yet.',
    url: privateHttpsReady ? privateHttps.url : '',
    rows: DEVICE_ROW_KEYS.map((key) => rowsByKey.get(key)).filter(Boolean),
  };
}

export const setupCompanionStatusModel = Object.freeze({
  buildRenderModel,
  buildServerModel,
  buildDeviceModel,
});
