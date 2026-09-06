export const PREREQUISITE_WAIT_INTERVAL_MS = 3000;
export const PREREQUISITE_WAIT_LIMIT_MS = 300000;

export function formatWaitElapsed(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function createPrerequisiteWait({ view, action, label, now = Date.now() }) {
  return {
    view,
    action,
    label: label || 'prerequisite',
    startedAt: now,
    pollInFlight: false,
    lastError: '',
    usesServerProgress: false,
  };
}

export function canStartPrerequisitePoll(wait) {
  return Boolean(wait) && !wait.pollInFlight;
}

export function shouldStartPrerequisiteWait(result) {
  return result?.status === 'opened';
}

export function hasPrerequisiteWaitTimedOut(
  wait,
  now = Date.now(),
  limitMs = PREREQUISITE_WAIT_LIMIT_MS,
) {
  return Boolean(wait) && now - wait.startedAt >= limitMs;
}

export function shouldCompletePrerequisiteWait(wait, model) {
  if (!wait) return false;
  return !model || model.actionKind !== 'prerequisite' || model.action !== wait.action;
}

export function buildPrerequisiteWaitMessage(
  wait,
  now = Date.now(),
  limitMs = PREREQUISITE_WAIT_LIMIT_MS,
) {
  const elapsed = formatWaitElapsed(now - wait.startedAt);
  const limit = formatWaitElapsed(limitMs);
  const retry = wait.lastError ? ' Last check failed; trying again.' : '';
  return `Waiting for ${wait.label}. Elapsed ${elapsed} of ${limit}.${retry}`;
}

export function buildPrerequisiteCompleteMessage(wait, model) {
  const label = model?.actionLabel || 'the next step';
  return `${wait.label} changed. Review ${label}, then continue when ready.`;
}

export function buildPrerequisiteTimeoutMessage(wait) {
  return `${wait.label} is not ready yet. Finish the prerequisite, then use Refresh checks.`;
}
