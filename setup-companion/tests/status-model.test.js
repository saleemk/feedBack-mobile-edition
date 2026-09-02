import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { buildRenderModel, formatGeneratedAt } from '../src/status-model.js';

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
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
