import { createHash, randomBytes } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  PermissionConfigSchema,
  SnapshotManifestSchema,
  type Guardrail,
  type PermissionConfig,
  type SnapshotManifest,
  type StatusReport,
  type Target,
} from './schema.js';
import { PRESET_NAMES, isDestructivePattern, presetPatterns, type PresetName } from './presets.js';

export function baseDir(override?: string): string {
  return override ?? process.env['WB_TRAE_CN'] ?? join(homedir(), '.trae-cn');
}

export function configFile(base: string, target: Target): string {
  return target === 'global'
    ? join(base, 'permission', 'global.json')
    : join(base, 'permission', 'work', 'global.json');
}

export function snapshotRoot(base: string): string {
  return join(base, 'permission', 'snapshots');
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function readConfig(file: string): PermissionConfig {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    throw new Error(`读不到配置文件：${file}`);
  }
  try {
    return PermissionConfigSchema.parse(JSON.parse(raw));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`配置校验失败（不会写入任何东西）：${file}\n${reason}`);
  }
}

function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, file);
}

export function writeConfig(file: string, config: PermissionConfig): void {
  const validated = PermissionConfigSchema.parse(config);
  writeAtomic(file, `${JSON.stringify(validated, null, 2)}\n`);
}

export function extractGuardrails(config: PermissionConfig): Guardrail {
  const profile = (config.customProfiles?.['defaultCustomProfile'] ?? {}) as Record<string, unknown>;
  const approval = (profile['approval'] ?? {}) as Record<string, unknown>;
  const scene = (approval['sceneRules'] ?? {}) as Record<string, unknown>;
  const sandbox = (profile['shellSandbox'] ?? {}) as Record<string, unknown>;
  return {
    dangerChecker: scene['commandAstDangerChecker'] === true,
    sandbox: sandbox['enable'] === true,
    reviewer: typeof approval['reviewer'] === 'string' ? approval['reviewer'] : 'unknown',
  };
}

export function destructiveAllows(config: PermissionConfig): string[] {
  return Object.entries(config.rules.commandRules)
    .filter(([pattern, rule]) => rule.approval === 'allow' && isDestructivePattern(pattern))
    .map(([pattern]) => pattern)
    .sort();
}

export function planPreset(
  config: PermissionConfig,
  name: PresetName,
): { add: string[]; already: string[] } {
  const add: string[] = [];
  const already: string[] = [];
  for (const pattern of presetPatterns(name)) {
    if (isDestructivePattern(pattern)) continue;
    const rule = config.rules.commandRules[pattern];
    if (rule?.approval === 'allow') already.push(pattern);
    else add.push(pattern);
  }
  return { add, already };
}

export function mergePreset(config: PermissionConfig, name: PresetName): PermissionConfig {
  const next: PermissionConfig = JSON.parse(JSON.stringify(config)) as PermissionConfig;
  for (const pattern of planPreset(config, name).add) {
    next.rules.commandRules[pattern] = { approval: 'allow', execEnv: 'host' };
  }
  return next;
}

export function snapshot(base: string, targets: readonly Target[]): SnapshotManifest {
  const files: SnapshotManifest['files'] = [];
  for (const target of targets) {
    const file = configFile(base, target);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    files.push({ target, file, sha256: sha256(text), bytes: Buffer.byteLength(text) });
  }
  if (files.length === 0) throw new Error('没有可快照的配置文件，已中止');

  const id = `${new Date().toISOString().slice(0, 19).replace(/[-:]/g, '')}Z-${randomBytes(2).toString('hex')}`;
  const dir = join(snapshotRoot(base), id);
  mkdirSync(dir, { recursive: true });

  for (const entry of files) {
    const dest = join(dir, `${entry.target}.json`);
    copyFileSync(entry.file, dest);
    const copied = readFileSync(dest, 'utf8');
    if (sha256(copied) !== entry.sha256) {
      throw new Error(`快照校验失败，已中止：${entry.file}`);
    }
  }

  const manifest = SnapshotManifestSchema.parse({
    version: 1,
    id,
    createdAt: new Date().toISOString(),
    files: files.map(({ target, file, sha256: hash, bytes }) => ({ target, file, sha256: hash, bytes })),
  });
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

export function listSnapshots(base: string): SnapshotManifest[] {
  const root = snapshotRoot(base);
  if (!existsSync(root)) return [];
  const manifests: SnapshotManifest[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(root, entry.name, 'manifest.json');
    if (!existsSync(manifestPath)) continue;
    try {
      manifests.push(SnapshotManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8'))));
    } catch {
      // 坏快照直接跳过，不因为一条脏数据让整个列表失败
    }
  }
  return manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function restore(base: string, id: string, targets: readonly Target[]): string[] {
  const dir = join(snapshotRoot(base), id);
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error(`找不到快照：${id}`);

  const manifest = SnapshotManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const restored: string[] = [];

  for (const entry of manifest.files) {
    if (!targets.includes(entry.target)) continue;
    const stored = join(dir, `${entry.target}.json`);
    const text = readFileSync(stored, 'utf8');
    if (sha256(text) !== entry.sha256) {
      throw new Error(`快照内容被改动过，拒绝恢复：${entry.target}`);
    }
    PermissionConfigSchema.parse(JSON.parse(text));
    writeAtomic(configFile(base, entry.target), text);
    restored.push(entry.target);
  }

  if (restored.length === 0) throw new Error('该快照里没有你要恢复的目标文件');
  return restored;
}

export function statusReport(config: PermissionConfig, target: Target): StatusReport {
  const guardrails = extractGuardrails(config);
  const presets = PRESET_NAMES.map((name) => {
    const { add, already } = planPreset(config, name);
    return {
      name,
      missing: add.length,
      covered: already.length,
      total: presetPatterns(name).length,
    };
  });

  return {
    target,
    activeProfile: config.activeProfileId ?? '(未设置)',
    ruleCount: Object.keys(config.rules.commandRules).length,
    guardrails: { ...guardrails, ok: guardrails.dangerChecker && guardrails.sandbox },
    destructiveAllows: destructiveAllows(config),
    presets,
  };
}
