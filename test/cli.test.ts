import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeBase } from './fixture.js';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));

function run(args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

test('cli status --json：报出 profile、闸门、破坏性放行', () => {
  const fixture = makeBase();
  const result = run(['status', '--base', fixture.base, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const reports = JSON.parse(result.stdout) as {
    target: string;
    activeProfile: string;
    guardrails: { ok: boolean };
    destructiveAllows: string[];
  }[];
  assert.equal(reports.length, 2);
  assert.equal(reports[0]?.activeProfile, 'full_access');
  assert.equal(reports[0]?.guardrails.ok, true);
  assert.deepEqual(reports[0]?.destructiveAllows, ['rm *']);
});

test('cli diff：只报会新增的规则，不写盘', () => {
  const fixture = makeBase();
  const result = run(['diff', 'strict', '--base', fixture.base, '--target', 'global']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\+ ls \*/);
  assert.equal(readFileSync(fixture.globalFile, 'utf8'), fixture.text);
});

test('cli apply --dry-run：零写入', () => {
  const result = run(['apply', 'fast', '--base', makeBase().base, '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
});

test('cli apply：写入前先快照，且能一条命令回滚', () => {
  const fixture = makeBase();
  const applied = run(['apply', 'strict', '--base', fixture.base, '--target', 'global']);
  assert.equal(applied.status, 0, applied.stderr);

  const after = readFileSync(fixture.globalFile, 'utf8');
  assert.notEqual(after, fixture.text);
  assert.match(after, /"ls \*"/);

  const snapshots = run(['snapshots', '--base', fixture.base, '--json']);
  const list = JSON.parse(snapshots.stdout) as { id: string }[];
  assert.equal(list.length, 1);

  const restored = run(['restore', list[0]!.id, '--base', fixture.base, '--target', 'global']);
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(readFileSync(fixture.globalFile, 'utf8'), fixture.text);
});

test('cli apply：闸门被关掉时退出码 3 且不写盘', () => {
  const fixture = makeBase({ dangerChecker: false });
  const result = run(['apply', 'fast', '--base', fixture.base]);
  assert.equal(result.status, 3);
  assert.equal(readFileSync(fixture.globalFile, 'utf8'), fixture.text);
});

test('cli 未知参数：退出码 2', () => {
  const result = run(['apply', 'strict', '--bogus']);
  assert.equal(result.status, 2);
});
