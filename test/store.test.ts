import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeBase } from './fixture.js';
import {
  configFile,
  destructiveAllows,
  extractGuardrails,
  hardenConfig,
  listSnapshots,
  mergePreset,
  planPreset,
  readConfig,
  restore,
  snapshot,
  statusReport,
  writeConfig,
} from '../src/store.js';
import { PRESETS, isDestructivePattern } from '../src/presets.js';

test('读取配置保留未知字段，不做破坏性重写', () => {
  const fixture = makeBase();
  const config = readConfig(fixture.globalFile);
  assert.deepEqual((config as Record<string, unknown>)['unknownFutureField'], { keep: true });
  writeConfig(fixture.globalFile, config);
  const rewritten = readConfig(fixture.globalFile);
  assert.deepEqual((rewritten as Record<string, unknown>)['unknownFutureField'], { keep: true });
});

test('预设只补缺口，不重复写已有规则', () => {
  const config = readConfig(makeBase().globalFile);
  const { add, already } = planPreset(config, 'strict');
  assert.ok(already.includes('cat *'));
  assert.ok(!add.includes('cat *'));
  assert.ok(add.includes('ls *'));
});

test('任何预设都不会把破坏性命令写成 allow', () => {
  for (const patterns of Object.values(PRESETS)) {
    for (const pattern of patterns) {
      assert.equal(isDestructivePattern(pattern), false, `预设里出现了 ${pattern}`);
    }
  }
});

test('mergePreset 不动 customProfiles 与 resourceAuthorization', () => {
  const config = readConfig(makeBase().globalFile);
  const merged = mergePreset(config, 'fast');
  assert.deepEqual(merged.customProfiles, config.customProfiles);
  assert.deepEqual(merged.resourceAuthorization, config.resourceAuthorization);
  assert.equal(merged.activeProfileId, config.activeProfileId);
  assert.equal(merged.rules.commandRules['rm *']?.approval, 'allow');
});

test('快照 → 改动 → 恢复，字节级一致', () => {
  const fixture = makeBase();
  const manifest = snapshot(fixture.base, ['global']);
  assert.ok(manifest.files[0]?.sha256);

  writeConfig(fixture.globalFile, { ...readConfig(fixture.globalFile), activeProfileId: 'changed' });
  assert.notEqual(readFileSync(fixture.globalFile, 'utf8'), fixture.text);

  const restored = restore(fixture.base, manifest.id, ['global']);
  assert.deepEqual(restored, ['global']);
  assert.equal(readFileSync(fixture.globalFile, 'utf8'), fixture.text);
});

test('快照内容被篡改时拒绝恢复', () => {
  const fixture = makeBase();
  const manifest = snapshot(fixture.base, ['global']);
  const stored = join(fixture.base, 'permission', 'snapshots', manifest.id, 'global.json');
  writeFileSync(stored, '{"tampered":true}\n', 'utf8');
  assert.throws(() => restore(fixture.base, manifest.id, ['global']), /被改动过/);
});

test('闸门被关掉时能如实报出来', () => {
  const config = readConfig(makeBase({ dangerChecker: false }).globalFile);
  assert.equal(extractGuardrails(config).dangerChecker, false);
  assert.equal(statusReport(config, 'global').guardrails.ok, false);
});

test('破坏性放行只读不写：识别 rm，但不误伤普通命令', () => {
  const config = readConfig(makeBase().globalFile);
  assert.deepEqual(destructiveAllows(config), ['rm *']);
  assert.equal(destructiveAllows(mergePreset(config, 'fast')).includes('rm *'), true);
});

test('非法 JSON 直接拒绝，原文件不动', () => {
  const fixture = makeBase();
  writeFileSync(fixture.globalFile, '{ not json', 'utf8');
  assert.throws(() => readConfig(fixture.globalFile), /配置校验失败/);
  assert.equal(readFileSync(fixture.globalFile, 'utf8'), '{ not json');
});

test('快照列表按时间倒序，坏快照被跳过', () => {
  const fixture = makeBase();
  snapshot(fixture.base, ['global']);
  snapshot(fixture.base, ['work']);
  const list = listSnapshots(fixture.base);
  assert.equal(list.length, 2);
});

test('配置文件路径按 target 区分', () => {
  const fixture = makeBase();
  assert.equal(configFile(fixture.base, 'work'), fixture.workFile);
  assert.equal(configFile(fixture.base, 'global'), fixture.globalFile);
});

test('harden：只把破坏性放行降级为 ask，普通规则不动', () => {
  const config = readConfig(makeBase().globalFile);
  const { config: next, changed } = hardenConfig(config);

  assert.deepEqual(changed, ['rm *']);
  assert.equal(next.rules.commandRules['rm *']?.approval, 'ask');
  assert.equal(next.rules.commandRules['cat *']?.approval, 'allow');
  assert.equal(config.rules.commandRules['rm *']?.approval, 'allow', '不能改原对象');
  assert.deepEqual(destructiveAllows(next), []);
});
