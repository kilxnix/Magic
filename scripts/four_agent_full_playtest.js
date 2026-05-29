#!/usr/bin/env node
/*
 * One-command four-agent verification lane:
 * 1. Four isolated browser contexts host/join a multiplayer Engine Beta room.
 * 2. /play starts a human + three Shelector opponents 1v1v1v1 practice game.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BASE_URL = (process.env.DECKREPS_BASE_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
const ARTIFACT_DIR = path.resolve(process.env.UI_PLAYTEST_ARTIFACT_DIR || 'playtest-artifacts/four-agent-full');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const RUN_DIR = path.join(ARTIFACT_DIR, RUN_ID);

fs.mkdirSync(RUN_DIR, { recursive: true });

function runStep(name, script, extraEnv) {
  const started = Date.now();
  const env = {
    ...process.env,
    DECKREPS_BASE_URL: BASE_URL,
    UI_PLAYTEST_ARTIFACT_DIR: path.join(RUN_DIR, name),
    ...extraEnv,
  };
  const result = spawnSync(process.execPath, [script], {
    cwd: path.resolve(__dirname, '..'),
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const outputPath = path.join(RUN_DIR, `${name}.stdout.txt`);
  const errorPath = path.join(RUN_DIR, `${name}.stderr.txt`);
  fs.writeFileSync(outputPath, result.stdout || '');
  fs.writeFileSync(errorPath, result.stderr || '');
  return {
    name,
    script,
    ok: result.status === 0,
    status: result.status,
    durationMs: Date.now() - started,
    stdout: outputPath,
    stderr: errorPath,
  };
}

const steps = [
  runStep('multiplayer-room-4p', 'scripts/goldfish_pod_ui_playtest.js', {
    GOLDFISH_POD_PLAYERS: process.env.GOLDFISH_POD_PLAYERS || '4',
    GOLDFISH_POD_ACTIONS: process.env.GOLDFISH_POD_ACTIONS || '80',
  }),
  runStep('shelector-play-4p', 'scripts/shelector_4p_ui_playtest.js', {
    SHELECTOR_4P_ACTIONS: process.env.SHELECTOR_4P_ACTIONS || '28',
  }),
];

const summary = {
  ok: steps.every(step => step.ok),
  baseUrl: BASE_URL,
  artifactDir: RUN_DIR,
  steps,
};

fs.writeFileSync(path.join(RUN_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

if (!summary.ok) {
  process.exit(1);
}
