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

const WORKFLOW_STAGES = Object.freeze({
  LIBRARY: 'library',
  SERVER: 'server',
  DEVICES: 'devices',
  CHECK: 'check',
});

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

function rowsByKeyFromModel(model) {
  return new Map(model.rows.map((row) => [row.key, row]));
}

function isReady(row) {
  return row?.status === 'ready';
}

function privateHttpsIsReady(row) {
  return isReady(row) && Boolean(row.url);
}

function privateHttpsCanBeEnabled(row) {
  return row?.status === 'needs_action';
}

function firstReason(...rows) {
  const row = rows.find((candidate) => candidate?.reason);
  return row?.reason || 'No status details returned.';
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

export function buildWorkflowModel(payload) {
  const model = buildRenderModel(payload);
  const rowsByKey = rowsByKeyFromModel(model);
  const repository = rowsByKey.get('repository') || {};
  const docker = rowsByKey.get('docker') || {};
  const server = rowsByKey.get('server') || {};
  const tailscale = rowsByKey.get('tailscale') || {};
  const privateHttps = rowsByKey.get('privateHttps') || {};
  const repositoryReady = isReady(repository);
  const dockerReady = isReady(docker);
  const serverReady = isReady(server);
  const tailscaleReady = isReady(tailscale);
  const mobileHttpsReady = privateHttpsIsReady(privateHttps);
  const serverOwnershipConflict = repositoryReady && serverReady && !dockerReady;

  const base = {
    stage: WORKFLOW_STAGES.CHECK,
    view: WORKFLOW_STAGES.CHECK,
    label: 'Setup complete',
    reason: 'Local and private mobile HTTPS access are ready.',
    tone: 'ready',
    state: 'complete',
    complete: true,
    locallyReady: true,
    actionable: false,
    blocked: false,
    serverConflict: false,
    automaticAction: null,
  };

  if (!repositoryReady) {
    return {
      ...base,
      stage: WORKFLOW_STAGES.LIBRARY,
      view: WORKFLOW_STAGES.LIBRARY,
      label: 'Choose library',
      reason: firstReason(repository),
      tone: repository.status === 'unavailable' || repository.status === 'blocked' ? 'error' : 'attention',
      state: repository.status === 'unavailable' || repository.status === 'blocked' ? 'blocked' : 'actionable',
      complete: false,
      locallyReady: false,
      actionable: repository.status !== 'unavailable' && repository.status !== 'blocked',
      blocked: repository.status === 'unavailable' || repository.status === 'blocked',
    };
  }

  if (serverOwnershipConflict) {
    return {
      ...base,
      stage: WORKFLOW_STAGES.SERVER,
      view: WORKFLOW_STAGES.SERVER,
      label: 'Existing server conflict',
      reason: 'A server is responding, but this checkout\'s Docker/Compose service is not ready. Resolve the port or service ownership conflict before controlling the server here.',
      tone: 'error',
      state: 'server_conflict',
      complete: false,
      locallyReady: false,
      actionable: false,
      blocked: true,
      serverConflict: true,
    };
  }

  if (!dockerReady || !serverReady) {
    const blocked = docker.status === 'unavailable' || docker.status === 'blocked' || server.status === 'unavailable' || server.status === 'blocked';
    return {
      ...base,
      stage: WORKFLOW_STAGES.SERVER,
      view: WORKFLOW_STAGES.SERVER,
      label: 'Start local server',
      reason: firstReason(!dockerReady ? docker : null, !serverReady ? server : null),
      tone: blocked ? 'error' : 'attention',
      state: blocked ? 'blocked' : 'actionable',
      complete: false,
      locallyReady: false,
      actionable: !blocked,
      blocked,
    };
  }

  if (!tailscaleReady || !mobileHttpsReady) {
    const canActOnDevices = tailscaleReady && privateHttpsCanBeEnabled(privateHttps);
    return {
      ...base,
      stage: WORKFLOW_STAGES.DEVICES,
      view: WORKFLOW_STAGES.DEVICES,
      label: 'Ready locally',
      reason: canActOnDevices
        ? firstReason(privateHttps)
        : tailscaleReady
          ? firstReason(privateHttps)
          : 'Local Mobile Edition is ready. Private phone and tablet HTTPS still needs Tailscale before mobile setup can finish.',
      tone: 'attention',
      state: canActOnDevices ? 'actionable' : 'locally_ready',
      complete: false,
      locallyReady: true,
      actionable: canActOnDevices,
      blocked: false,
    };
  }

  return base;
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
  const rowsByKey = rowsByKeyFromModel(model);
  const repository = rowsByKey.get('repository') || {};
  const docker = rowsByKey.get('docker') || {};
  const server = rowsByKey.get('server') || {};
  const serverReady = server.status === 'ready';
  const serverOwnershipConflict = repository.status === 'ready' && serverReady && docker.status !== 'ready';
  const action = serverReady ? 'restart' : 'start';

  let disabledReason = '';
  if (repository.status !== 'ready') {
    disabledReason = 'Finish library configuration before starting the server.';
  } else if (serverOwnershipConflict) {
    disabledReason = 'A server is responding, but this checkout\'s Docker/Compose service is not ready. Resolve the port or service ownership conflict before controlling the server here.';
  } else if (docker.status === 'unavailable') {
    disabledReason = docker.reason || 'Docker is unavailable.';
  }

  const actionHint = serverReady
    ? 'Restart only the Mobile Edition web service.'
    : 'Start the Mobile Edition release stack. The first build may take a few minutes.';

  return {
    action: serverOwnershipConflict ? 'none' : action,
    actionLabel: serverOwnershipConflict ? 'Resolve conflict' : serverReady ? 'Restart server' : 'Start server',
    canRun: !disabledReason,
    disabledReason,
    actionHint: serverOwnershipConflict ? disabledReason : actionHint,
    badgeLabel: serverOwnershipConflict ? 'Server conflict' : serverReady ? 'Server ready' : 'Server not ready',
    badgeTone: serverOwnershipConflict ? 'error' : serverReady ? 'ready' : 'attention',
    summary: serverOwnershipConflict ? disabledReason : server.reason || 'No local server status returned.',
    conflict: serverOwnershipConflict,
    rows: SERVER_ROW_KEYS.map((key) => rowsByKey.get(key)).filter(Boolean),
  };
}

export function buildDeviceModel(payload) {
  const model = buildRenderModel(payload);
  const rowsByKey = rowsByKeyFromModel(model);
  const server = rowsByKey.get('server') || {};
  const tailscale = rowsByKey.get('tailscale') || {};
  const privateHttps = rowsByKey.get('privateHttps') || {};
  const privateHttpsReady = privateHttps.status === 'ready' && Boolean(privateHttps.url);
  const canEnablePrivateHttps = server.status === 'ready'
    && tailscale.status === 'ready'
    && privateHttpsCanBeEnabled(privateHttps);
  const action = privateHttpsReady ? 'open_guide' : canEnablePrivateHttps ? 'enable_https' : 'none';

  let disabledReason = '';
  if (server.status !== 'ready') {
    disabledReason = server.reason || 'Start the local server before connecting devices.';
  } else if (tailscale.status !== 'ready') {
    disabledReason = tailscale.reason || 'Tailscale must be ready before private HTTPS can be configured.';
  } else if (privateHttps.status === 'ready' && !privateHttps.url) {
    disabledReason = 'Private HTTPS is ready, but the setup doctor did not return a URL.';
  } else if (!privateHttpsReady && !canEnablePrivateHttps) {
    disabledReason = privateHttps.reason || 'Private HTTPS status is unknown. Refresh checks before configuring device access.';
  }

  const actionHint = privateHttpsReady
    ? 'Create and open the local phone/tablet QR guide.'
    : canEnablePrivateHttps
      ? 'Enable the existing guarded Tailscale Serve HTTPS path for this configured port.'
      : disabledReason;

  return {
    action,
    actionLabel: privateHttpsReady
      ? 'Open device guide'
      : canEnablePrivateHttps
        ? 'Enable private HTTPS'
        : 'Private HTTPS unavailable',
    canRun: !disabledReason,
    disabledReason,
    actionHint,
    badgeLabel: privateHttpsReady ? 'Devices ready' : server.status === 'ready' ? 'Ready locally' : 'Devices need setup',
    badgeTone: privateHttpsReady ? 'ready' : 'attention',
    summary: privateHttpsReady
      ? 'Private HTTPS is ready for phones and tablets.'
      : server.status === 'ready' && tailscale.status !== 'ready'
        ? 'Local Mobile Edition is ready. Private phone and tablet HTTPS still needs Tailscale.'
      : privateHttps.reason || 'Private HTTPS is not ready yet.',
    url: privateHttpsReady ? privateHttps.url : '',
    rows: DEVICE_ROW_KEYS.map((key) => rowsByKey.get(key)).filter(Boolean),
  };
}

export const setupCompanionStatusModel = Object.freeze({
  buildRenderModel,
  buildWorkflowModel,
  buildServerModel,
  buildDeviceModel,
});
