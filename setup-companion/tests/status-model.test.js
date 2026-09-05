import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  buildDeviceModel,
  buildRenderModel,
  buildServerModel,
  buildWorkflowModel,
  formatGeneratedAt,
} from '../src/status-model.js';

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('buildRenderModel maps ready fixture into ordered rows', async () => {
  const model = buildRenderModel(await fixture('ready'));

  assert.equal(model.overall.label, 'Ready');
  assert.equal(model.overall.tone, 'ready');
  assert.deepEqual(model.rows.map((row) => row.label), [
    'Repository configuration',
    'Docker and Compose',
    'Edition server',
    'Tailscale',
    'Private HTTPS access',
  ]);
  assert.equal(model.rows.at(-1).url, 'https://desktop.example.ts.net');
});

test('buildRenderModel preserves optional remediation contract fields', async () => {
  const payload = clone(await fixture('ready'));
  payload.checks.docker.status = 'unavailable';
  payload.checks.docker.reason = 'Docker prerequisite key test.';
  payload.checks.docker.remediation = 'get_docker';
  const model = buildRenderModel(payload);

  assert.equal(model.rows.find((row) => row.key === 'docker').remediation, 'get_docker');
});

test('buildRenderModel labels action and unavailable states', async () => {
  const needsAction = buildRenderModel(await fixture('needs-action'));
  const unavailable = buildRenderModel(await fixture('unavailable'));

  assert.equal(needsAction.overall.tone, 'error');
  assert.equal(needsAction.overall.label, 'Needs action');
  assert.equal(needsAction.rows[0].statusLabel, 'Needs action');
  assert.equal(needsAction.rows[0].tone, 'attention');
  assert.match(needsAction.rows[0].nextAction, /Copy-Item/);
  assert.equal(unavailable.rows[3].statusLabel, 'Unavailable');
  assert.equal(unavailable.rows[3].tone, 'error');
});

test('buildRenderModel shapes bridge errors without fake success', () => {
  const model = buildRenderModel({
    overall: { status: 'blocked', reason: 'The setup doctor could not run.' },
    checks: {},
  });

  assert.equal(model.overall.label, 'Needs action');
  assert.equal(model.overall.tone, 'error');
  assert.equal(model.rows.length, 5);
  assert.equal(model.rows[0].reason, 'No status details returned.');
});

test('formatGeneratedAt hides invalid values and removes ISO precision noise', () => {
  assert.equal(formatGeneratedAt('not-a-date'), '');
  const formatted = formatGeneratedAt('2026-09-01T22:22:30.1332318Z');
  assert.doesNotMatch(formatted, /T22:22:30|1332318/);
});

test('buildServerModel chooses restart when the local server is ready', async () => {
  const model = buildServerModel(await fixture('ready'));

  assert.equal(model.action, 'restart');
  assert.equal(model.actionLabel, 'Restart server');
  assert.equal(model.canRun, true);
  assert.equal(model.rows.map((row) => row.key).join(','), 'docker,server');
});

test('buildServerModel chooses start for a stopped server and blocks unsafe prerequisites', async () => {
  const startablePayload = await fixture('ready');
  startablePayload.checks.server.status = 'needs_action';
  startablePayload.checks.server.reason = 'The local Mobile Edition server is not reachable on localhost.';
  const startable = buildServerModel(startablePayload);

  assert.equal(startable.action, 'start');
  assert.equal(startable.actionKind, 'server');
  assert.equal(startable.actionLabel, 'Start server');
  assert.equal(startable.canRun, true);

  const repositoryBlocked = buildServerModel(await fixture('needs-action'));
  assert.equal(repositoryBlocked.canRun, false);
  assert.match(repositoryBlocked.disabledReason, /library configuration/i);

  const dockerUnavailablePayload = await fixture('ready');
  dockerUnavailablePayload.checks.docker.status = 'unavailable';
  dockerUnavailablePayload.checks.docker.reason = 'Docker CLI is not available.';
  dockerUnavailablePayload.checks.server.status = 'needs_action';
  const dockerUnavailable = buildServerModel(dockerUnavailablePayload);

  assert.equal(dockerUnavailable.canRun, false);
  assert.match(dockerUnavailable.disabledReason, /Docker CLI/);
});

test('buildServerModel selects Docker prerequisite and server actions from remediation keys', async () => {
  const getDockerPayload = clone(await fixture('ready'));
  getDockerPayload.checks.docker.status = 'unavailable';
  getDockerPayload.checks.docker.reason = 'Install guidance is available.';
  getDockerPayload.checks.docker.nextAction = 'Human text that does not name Docker.';
  getDockerPayload.checks.docker.remediation = 'get_docker';
  getDockerPayload.checks.server.status = 'needs_action';
  const getDocker = buildServerModel(getDockerPayload);

  assert.equal(getDocker.actionKind, 'prerequisite');
  assert.equal(getDocker.action, 'get_docker');
  assert.equal(getDocker.actionLabel, 'Get Docker Desktop');
  assert.equal(getDocker.canRun, true);

  const openDockerPayload = clone(await fixture('ready'));
  openDockerPayload.checks.docker.status = 'needs_action';
  openDockerPayload.checks.docker.reason = 'Daemon is not reachable.';
  openDockerPayload.checks.docker.nextAction = 'Human text that does not name Docker Desktop.';
  openDockerPayload.checks.docker.remediation = 'open_docker';
  openDockerPayload.checks.server.status = 'needs_action';
  const openDocker = buildServerModel(openDockerPayload);

  assert.equal(openDocker.actionKind, 'prerequisite');
  assert.equal(openDocker.action, 'open_docker');
  assert.equal(openDocker.actionLabel, 'Open Docker Desktop');
  assert.equal(openDocker.canRun, true);

  const stoppedContainerPayload = clone(await fixture('ready'));
  stoppedContainerPayload.checks.docker.status = 'needs_action';
  stoppedContainerPayload.checks.docker.reason = 'Container is stopped.';
  stoppedContainerPayload.checks.docker.remediation = 'start_server';
  stoppedContainerPayload.checks.server.status = 'needs_action';
  const stoppedContainer = buildServerModel(stoppedContainerPayload);

  assert.equal(stoppedContainer.actionKind, 'server');
  assert.equal(stoppedContainer.action, 'start');
  assert.equal(stoppedContainer.actionLabel, 'Start server');
  assert.equal(stoppedContainer.canRun, true);

  const invalidComposePayload = clone(await fixture('ready'));
  invalidComposePayload.checks.docker.status = 'needs_action';
  invalidComposePayload.checks.docker.reason = 'Compose config is invalid.';
  invalidComposePayload.checks.docker.nextAction = 'Run the compose config check.';
  invalidComposePayload.checks.server.status = 'needs_action';
  const invalidCompose = buildServerModel(invalidComposePayload);

  assert.equal(invalidCompose.actionKind, 'none');
  assert.equal(invalidCompose.action, 'none');
  assert.equal(invalidCompose.canRun, false);
  assert.match(invalidCompose.disabledReason, /Compose config is invalid/);
});

test('buildServerModel disables control for existing server ownership conflicts', async () => {
  const conflictPayload = await fixture('ready');
  conflictPayload.checks.docker.status = 'needs_action';
  conflictPayload.checks.docker.reason = 'This checkout Docker service is not ready.';
  const model = buildServerModel(conflictPayload);

  assert.equal(model.conflict, true);
  assert.equal(model.action, 'none');
  assert.equal(model.actionKind, 'none');
  assert.equal(model.actionLabel, 'Resolve conflict');
  assert.equal(model.canRun, false);
  assert.equal(model.badgeLabel, 'Server conflict');
  assert.equal(model.badgeTone, 'error');
  assert.match(model.disabledReason, /server is responding/i);
  assert.match(model.disabledReason, /Docker\/Compose service is not ready/);
});

test('buildDeviceModel blocks server and Tailscale prerequisites', async () => {
  const serverDownPayload = await fixture('ready');
  serverDownPayload.checks.server.status = 'needs_action';
  serverDownPayload.checks.server.reason = 'The local Mobile Edition server is not reachable on localhost.';
  serverDownPayload.checks.privateHttps.status = 'needs_action';
  delete serverDownPayload.checks.privateHttps.url;
  const serverDown = buildDeviceModel(serverDownPayload);

  assert.equal(serverDown.action, 'none');
  assert.equal(serverDown.actionKind, 'none');
  assert.equal(serverDown.actionLabel, 'Private HTTPS unavailable');
  assert.equal(serverDown.canRun, false);
  assert.match(serverDown.disabledReason, /server is not reachable/);

  const tailscaleUnavailable = buildDeviceModel(await fixture('unavailable'));
  assert.equal(tailscaleUnavailable.action, 'none');
  assert.equal(tailscaleUnavailable.actionKind, 'none');
  assert.equal(tailscaleUnavailable.canRun, false);
  assert.match(tailscaleUnavailable.disabledReason, /Tailscale CLI/);

  const tailscaleNeedsActionPayload = await fixture('ready');
  tailscaleNeedsActionPayload.checks.tailscale.status = 'needs_action';
  tailscaleNeedsActionPayload.checks.tailscale.reason = 'Tailscale is installed, but it is not signed in.';
  tailscaleNeedsActionPayload.checks.privateHttps.status = 'needs_action';
  tailscaleNeedsActionPayload.checks.privateHttps.url = '';
  const tailscaleNeedsAction = buildDeviceModel(tailscaleNeedsActionPayload);

  assert.equal(tailscaleNeedsAction.action, 'none');
  assert.equal(tailscaleNeedsAction.actionKind, 'none');
  assert.equal(tailscaleNeedsAction.canRun, false);
  assert.match(tailscaleNeedsAction.disabledReason, /not signed in/);
});

test('buildDeviceModel chooses HTTPS enablement or guide opening from doctor truth', async () => {
  const httpsAbsentPayload = await fixture('ready');
  httpsAbsentPayload.checks.privateHttps.status = 'needs_action';
  httpsAbsentPayload.checks.privateHttps.reason = 'Tailscale Serve is not exposing this Edition port.';
  delete httpsAbsentPayload.checks.privateHttps.url;
  const httpsAbsent = buildDeviceModel(httpsAbsentPayload);

  assert.equal(httpsAbsent.action, 'enable_https');
  assert.equal(httpsAbsent.actionKind, 'device');
  assert.equal(httpsAbsent.actionLabel, 'Enable private HTTPS');
  assert.equal(httpsAbsent.canRun, true);
  assert.equal(httpsAbsent.rows.map((row) => row.key).join(','), 'server,tailscale,privateHttps');

  const ready = buildDeviceModel(await fixture('ready'));
  assert.equal(ready.action, 'open_guide');
  assert.equal(ready.actionKind, 'device');
  assert.equal(ready.actionLabel, 'Open device guide');
  assert.equal(ready.canRun, true);
  assert.equal(ready.url, 'https://desktop.example.ts.net');
  assert.equal(ready.badgeLabel, 'Devices ready');
});

test('buildDeviceModel selects Tailscale prerequisite actions from remediation keys', async () => {
  const getTailscalePayload = clone(await fixture('ready'));
  getTailscalePayload.checks.tailscale.status = 'unavailable';
  getTailscalePayload.checks.tailscale.reason = 'Install guidance is available.';
  getTailscalePayload.checks.tailscale.nextAction = 'Human text that does not name Tailscale.';
  getTailscalePayload.checks.tailscale.remediation = 'get_tailscale';
  getTailscalePayload.checks.privateHttps.status = 'needs_action';
  delete getTailscalePayload.checks.privateHttps.url;
  const getTailscale = buildDeviceModel(getTailscalePayload);

  assert.equal(getTailscale.actionKind, 'prerequisite');
  assert.equal(getTailscale.action, 'get_tailscale');
  assert.equal(getTailscale.actionLabel, 'Get Tailscale');
  assert.equal(getTailscale.canRun, true);
  assert.equal(getTailscale.badgeLabel, 'Ready locally');

  const openTailscalePayload = clone(await fixture('ready'));
  openTailscalePayload.checks.tailscale.status = 'needs_action';
  openTailscalePayload.checks.tailscale.reason = 'Tailscale needs attention.';
  openTailscalePayload.checks.tailscale.nextAction = 'Human text that does not say open.';
  openTailscalePayload.checks.tailscale.remediation = 'tailscale_help';
  openTailscalePayload.checks.privateHttps.status = 'needs_action';
  delete openTailscalePayload.checks.privateHttps.url;
  const openTailscale = buildDeviceModel(openTailscalePayload);

  assert.equal(openTailscale.actionKind, 'prerequisite');
  assert.equal(openTailscale.action, 'tailscale_help');
  assert.equal(openTailscale.actionLabel, 'Tailscale sign-in steps');
  assert.equal(openTailscale.canRun, true);
  assert.equal(openTailscale.badgeLabel, 'Ready locally');
});

test('prerequisite model actions stay separate from server and device mutating actions', async () => {
  const dockerPayload = clone(await fixture('ready'));
  dockerPayload.checks.docker.status = 'unavailable';
  dockerPayload.checks.docker.remediation = 'get_docker';
  dockerPayload.checks.server.status = 'needs_action';
  const dockerModel = buildServerModel(dockerPayload);

  assert.equal(dockerModel.actionKind, 'prerequisite');
  assert.doesNotMatch(dockerModel.action, /^(start|restart)$/);

  const tailscalePayload = clone(await fixture('ready'));
  tailscalePayload.checks.tailscale.status = 'needs_action';
  tailscalePayload.checks.tailscale.remediation = 'tailscale_help';
  tailscalePayload.checks.privateHttps.status = 'needs_action';
  delete tailscalePayload.checks.privateHttps.url;
  const tailscaleModel = buildDeviceModel(tailscalePayload);

  assert.equal(tailscaleModel.actionKind, 'prerequisite');
  assert.doesNotMatch(tailscaleModel.action, /^(enable_https|open_guide)$/);
});

test('buildDeviceModel disables unavailable private HTTPS while preserving local readiness', async () => {
  const payload = clone(await fixture('ready'));
  payload.checks.privateHttps.status = 'unavailable';
  payload.checks.privateHttps.reason = 'Tailscale Serve status could not be inspected.';
  delete payload.checks.privateHttps.url;
  const model = buildDeviceModel(payload);

  assert.equal(model.action, 'none');
  assert.equal(model.actionKind, 'none');
  assert.equal(model.actionLabel, 'Private HTTPS unavailable');
  assert.equal(model.canRun, false);
  assert.equal(model.badgeLabel, 'Ready locally');
  assert.equal(model.badgeTone, 'attention');
  assert.match(model.disabledReason, /Serve status could not be inspected/);
  assert.match(model.summary, /Serve status could not be inspected/);
  assert.equal(model.url, '');
});

test('buildWorkflowModel routes clean first run to Library without automatic action', async () => {
  const workflow = buildWorkflowModel(await fixture('needs-action'));

  assert.equal(workflow.stage, 'library');
  assert.equal(workflow.view, 'library');
  assert.equal(workflow.state, 'actionable');
  assert.equal(workflow.complete, false);
  assert.equal(workflow.locallyReady, false);
  assert.equal(workflow.actionable, true);
  assert.equal(workflow.automaticAction, null);
  assert.match(workflow.label, /library/i);
});

test('buildWorkflowModel routes configured library with stopped server to Server', async () => {
  const payload = clone(await fixture('ready'));
  payload.checks.server.status = 'needs_action';
  payload.checks.server.reason = 'The local Mobile Edition server is not reachable on localhost.';
  payload.checks.privateHttps.status = 'needs_action';
  delete payload.checks.privateHttps.url;
  const workflow = buildWorkflowModel(payload);

  assert.equal(workflow.stage, 'server');
  assert.equal(workflow.view, 'server');
  assert.equal(workflow.state, 'actionable');
  assert.equal(workflow.actionable, true);
  assert.equal(workflow.automaticAction, null);
  assert.match(workflow.reason, /server is not reachable/);
});

test('buildWorkflowModel skips Server when this checkout server is already ready', async () => {
  const workflow = buildWorkflowModel(await fixture('unavailable'));

  assert.equal(workflow.stage, 'devices');
  assert.equal(workflow.view, 'devices');
  assert.equal(workflow.label, 'Ready locally');
  assert.equal(workflow.locallyReady, true);
  assert.equal(workflow.automaticAction, null);
});

test('buildWorkflowModel classifies responding server plus non-ready Compose as conflict', async () => {
  const payload = clone(await fixture('ready'));
  payload.checks.docker.status = 'needs_action';
  payload.checks.docker.reason = 'This checkout Docker service is not ready.';
  const workflow = buildWorkflowModel(payload);

  assert.equal(workflow.stage, 'server');
  assert.equal(workflow.view, 'server');
  assert.equal(workflow.state, 'server_conflict');
  assert.equal(workflow.serverConflict, true);
  assert.equal(workflow.actionable, false);
  assert.equal(workflow.blocked, true);
  assert.equal(workflow.automaticAction, null);
  assert.match(workflow.reason, /server is responding/i);
});

test('buildWorkflowModel presents Tailscale unavailable as locally ready Devices state', async () => {
  const payload = await fixture('unavailable');
  const workflow = buildWorkflowModel(payload);
  const devices = buildDeviceModel(payload);

  assert.equal(workflow.stage, 'devices');
  assert.equal(workflow.view, 'devices');
  assert.equal(workflow.state, 'locally_ready');
  assert.equal(workflow.label, 'Ready locally');
  assert.equal(workflow.locallyReady, true);
  assert.equal(workflow.actionable, false);
  assert.equal(workflow.blocked, false);
  assert.equal(workflow.automaticAction, null);
  assert.equal(devices.badgeLabel, 'Ready locally');
  assert.equal(devices.canRun, false);
  assert.match(devices.summary, /Local Mobile Edition is ready/);
});

test('buildWorkflowModel routes private HTTPS missing with Tailscale ready to actionable Devices', async () => {
  const payload = clone(await fixture('ready'));
  payload.checks.privateHttps.status = 'needs_action';
  payload.checks.privateHttps.reason = 'Tailscale Serve is not exposing this Edition port.';
  delete payload.checks.privateHttps.url;
  const workflow = buildWorkflowModel(payload);
  const devices = buildDeviceModel(payload);

  assert.equal(workflow.stage, 'devices');
  assert.equal(workflow.view, 'devices');
  assert.equal(workflow.state, 'actionable');
  assert.equal(workflow.label, 'Ready locally');
  assert.equal(workflow.locallyReady, true);
  assert.equal(workflow.actionable, true);
  assert.equal(workflow.automaticAction, null);
  assert.equal(devices.action, 'enable_https');
  assert.equal(devices.canRun, true);
});

test('buildWorkflowModel keeps unavailable private HTTPS on locally ready Devices', async () => {
  const payload = clone(await fixture('ready'));
  payload.checks.privateHttps.status = 'unavailable';
  payload.checks.privateHttps.reason = 'Tailscale Serve status could not be inspected.';
  delete payload.checks.privateHttps.url;
  const workflow = buildWorkflowModel(payload);

  assert.equal(workflow.stage, 'devices');
  assert.equal(workflow.view, 'devices');
  assert.equal(workflow.state, 'locally_ready');
  assert.equal(workflow.label, 'Ready locally');
  assert.equal(workflow.locallyReady, true);
  assert.equal(workflow.actionable, false);
  assert.equal(workflow.blocked, false);
  assert.equal(workflow.automaticAction, null);
  assert.match(workflow.reason, /Serve status could not be inspected/);
});

test('buildWorkflowModel routes all-ready returning installs to Check dashboard', async () => {
  const workflow = buildWorkflowModel(await fixture('ready'));

  assert.equal(workflow.stage, 'check');
  assert.equal(workflow.view, 'check');
  assert.equal(workflow.state, 'complete');
  assert.equal(workflow.label, 'Setup complete');
  assert.equal(workflow.complete, true);
  assert.equal(workflow.locallyReady, true);
  assert.equal(workflow.automaticAction, null);
});

test('buildWorkflowModel never derives an automatic mutating action for any stage', async () => {
  const ready = await fixture('ready');
  const cases = [
    await fixture('needs-action'),
    { ...clone(ready), checks: { ...clone(ready.checks), server: { ...ready.checks.server, status: 'needs_action' } } },
    { ...clone(ready), checks: { ...clone(ready.checks), docker: { ...ready.checks.docker, status: 'needs_action' } } },
    await fixture('unavailable'),
    { ...clone(ready), checks: { ...clone(ready.checks), privateHttps: { status: 'needs_action', reason: 'Private HTTPS missing.' } } },
    { ...clone(ready), checks: { ...clone(ready.checks), privateHttps: { status: 'unavailable', reason: 'Private HTTPS could not be inspected.' } } },
    ready,
  ];

  for (const payload of cases) {
    assert.equal(buildWorkflowModel(payload).automaticAction, null);
  }
});
