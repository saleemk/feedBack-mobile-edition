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

export const setupCompanionStatusModel = Object.freeze({
  buildRenderModel,
});
