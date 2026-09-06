import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { buildDeviceModel, buildServerModel } from '../src/status-model.js';
import {
  PREREQUISITE_WAIT_LIMIT_MS,
  buildPrerequisiteCompleteMessage,
  buildPrerequisiteTimeoutMessage,
  buildPrerequisiteWaitMessage,
  canStartPrerequisitePoll,
  createPrerequisiteWait,
  hasPrerequisiteWaitTimedOut,
  shouldCompletePrerequisiteWait,
  shouldStartPrerequisiteWait,
} from '../src/wait-policy.js';

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('prerequisite wait continues while the same prerequisite action remains', () => {
  const wait = createPrerequisiteWait({
    view: 'server',
    action: 'get_docker',
    label: 'Get Docker Desktop',
    now: 1000,
  });
  const model = {
    actionKind: 'prerequisite',
    action: 'get_docker',
    actionLabel: 'Get Docker Desktop',
  };

  assert.equal(shouldCompletePrerequisiteWait(wait, model), false);
  assert.equal(wait.usesServerProgress, false);
  assert.equal(buildPrerequisiteWaitMessage(wait, 4000), 'Waiting for Get Docker Desktop. Elapsed 0:03 of 5:00.');
});

test('prerequisite wait completes when the originating action changes or disappears', () => {
  const wait = createPrerequisiteWait({
    view: 'devices',
    action: 'get_tailscale',
    label: 'Get Tailscale',
    now: 0,
  });

  assert.equal(shouldCompletePrerequisiteWait(wait, {
    actionKind: 'prerequisite',
    action: 'tailscale_help',
    actionLabel: 'Tailscale sign-in steps',
  }), true);
  assert.equal(shouldCompletePrerequisiteWait(wait, {
    actionKind: 'device',
    action: 'enable_https',
    actionLabel: 'Enable private HTTPS',
  }), true);
  assert.match(
    buildPrerequisiteCompleteMessage(wait, { actionLabel: 'Enable private HTTPS' }),
    /Enable private HTTPS/,
  );
});

test('prerequisite wait timeout is bounded and produces useful copy', () => {
  const wait = createPrerequisiteWait({
    view: 'server',
    action: 'open_docker',
    label: 'Open Docker Desktop',
    now: 1000,
  });

  assert.equal(hasPrerequisiteWaitTimedOut(wait, 1000 + PREREQUISITE_WAIT_LIMIT_MS - 1), false);
  assert.equal(hasPrerequisiteWaitTimedOut(wait, 1000 + PREREQUISITE_WAIT_LIMIT_MS), true);
  assert.match(buildPrerequisiteTimeoutMessage(wait), /not ready yet/);
  assert.match(buildPrerequisiteTimeoutMessage(wait), /Refresh checks/);
});

test('manual refresh and polling do not overlap prerequisite doctor invocations', () => {
  const wait = createPrerequisiteWait({
    view: 'server',
    action: 'get_docker',
    label: 'Get Docker Desktop',
  });

  assert.equal(canStartPrerequisitePoll(wait), true);
  wait.pollInFlight = true;
  assert.equal(canStartPrerequisitePoll(wait), false);
});

test('failed prerequisite helper results do not start waiting', () => {
  assert.equal(shouldStartPrerequisiteWait({ status: 'opened' }), true);
  assert.equal(shouldStartPrerequisiteWait({ status: 'failed' }), false);
  assert.equal(shouldStartPrerequisiteWait(null), false);
});

test('successful wait completion exposes next server action without invoking it', async () => {
  const payload = clone(await fixture('ready'));
  payload.checks.docker.status = 'needs_action';
  payload.checks.docker.remediation = 'open_docker';
  payload.checks.server.status = 'needs_action';
  const wait = createPrerequisiteWait({
    view: 'server',
    action: 'open_docker',
    label: 'Open Docker Desktop',
  });

  const waitingModel = buildServerModel(payload);
  assert.equal(shouldCompletePrerequisiteWait(wait, waitingModel), false);

  payload.checks.docker.status = 'needs_action';
  payload.checks.docker.remediation = 'start_server';
  const nextModel = buildServerModel(payload);

  assert.equal(shouldCompletePrerequisiteWait(wait, nextModel), true);
  assert.equal(nextModel.actionKind, 'server');
  assert.equal(nextModel.action, 'start');
});

test('successful wait completion exposes next device action without invoking it', async () => {
  const payload = clone(await fixture('ready'));
  payload.checks.tailscale.status = 'needs_action';
  payload.checks.tailscale.remediation = 'tailscale_help';
  payload.checks.privateHttps.status = 'needs_action';
  delete payload.checks.privateHttps.url;
  const wait = createPrerequisiteWait({
    view: 'devices',
    action: 'tailscale_help',
    label: 'Tailscale sign-in steps',
  });

  const waitingModel = buildDeviceModel(payload);
  assert.equal(shouldCompletePrerequisiteWait(wait, waitingModel), false);

  payload.checks.tailscale.status = 'ready';
  delete payload.checks.tailscale.remediation;
  const nextModel = buildDeviceModel(payload);

  assert.equal(shouldCompletePrerequisiteWait(wait, nextModel), true);
  assert.equal(nextModel.actionKind, 'device');
  assert.equal(nextModel.action, 'enable_https');
});
