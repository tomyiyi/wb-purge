#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { ZodError } from 'zod';
import { PRESET_NAMES, type PresetName } from './presets.js';
import {
  baseDir,
  configFile,
  destructiveAllows,
  listSnapshots,
  mergePreset,
  planPreset,
  readConfig,
  restore,
  snapshot,
  statusReport,
  writeConfig,
  extractGuardrails,
  hardenConfig,
  compactConfig,
} from './store.js';
import type { Target } from './schema.js';

const USAGE = `wb-purge — 清掉 WorkBuddy 的审批摩擦，保留三道真闸

用法：
  wb-purge status [--target global|work|both] [--json]   现状体检
  wb-purge diff <strict|fast> [--target ...]             只看会加哪些规则
  wb-purge apply <strict|fast> [--dry-run] [--target ...] 快照 → 合并 → 写盘
  wb-purge harden [--dry-run]                            把已放行的破坏性命令降级为 ask
  wb-purge compact [--dry-run]                           删除被「X *」覆盖的冗余规则
  wb-purge snapshots [--json]                            列出快照
  wb-purge restore <快照ID> [--target ...]                回滚

通用：--base <dir> 覆盖 ~/.trae-cn（测试用）
退出码：0 成功 / 2 参数或校验失败 / 3 闸门被关，拒绝批量放行`;

type Flags = {
  base: string;
  target: Target | 'both';
  json: boolean;
  dryRun: boolean;
  rest: string[];
};

function parseArgs(args: string[]): Flags {
  const flags: Flags = { base: baseDir(), target: 'both', json: false, dryRun: false, rest: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? '';
    const next = args[i + 1];
    switch (arg) {
      case '--base':
        if (!next) throw new Error('--base 需要一个目录');
        flags.base = next;
        i += 1;
        break;
      case '--target': {
        if (next !== 'global' && next !== 'work' && next !== 'both') {
          throw new Error('--target 只接受 global / work / both');
        }
        flags.target = next;
        i += 1;
        break;
      }
      case '--json':
        flags.json = true;
        break;
      case '--dry-run':
        flags.dryRun = true;
        break;
      default:
        if (arg.startsWith('--')) throw new Error(`未知参数：${arg}`);
        flags.rest.push(arg);
    }
  }
  return flags;
}

function targetsOf(target: Target | 'both'): Target[] {
  return target === 'both' ? ['global', 'work'] : [target];
}

function parsePreset(value: string | undefined): PresetName {
  const hit = PRESET_NAMES.find((name) => name === value);
  if (!hit) throw new Error(`预设只接受 ${PRESET_NAMES.join(' / ')}`);
  return hit;
}

function main(): number {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? 'help';

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return 0;
  }

  const flags = parseArgs(argv.slice(1));

  if (command === 'status') {
    const reports = targetsOf(flags.target)
      .filter((target) => existsSync(configFile(flags.base, target)))
      .map((target) => statusReport(readConfig(configFile(flags.base, target)), target));

    if (reports.length === 0) throw new Error(`在 ${flags.base}/permission 下没找到配置文件`);

    if (flags.json) {
      console.log(JSON.stringify(reports, null, 2));
      return 0;
    }

    for (const report of reports) {
      console.log(`\n== ${report.target} ==`);
      console.log(`profile=${report.activeProfile}  已放行规则=${report.ruleCount}`);
      console.log(
        `三道闸：危险命令检查=${report.guardrails.dangerChecker ? '开' : '关'} / 沙箱=${report.guardrails.sandbox ? '开' : '关'} / 复核人=${report.guardrails.reviewer} → ${report.guardrails.ok ? '完整' : '被关过'}`,
      );
      if (report.destructiveAllows.length > 0) {
        console.log(`破坏性命令已被放行（${report.destructiveAllows.length} 条，本工具不会替你加，也不会替你删）：`);
        console.log(`  ${report.destructiveAllows.join('  ')}`);
      }
      for (const preset of report.presets) {
        console.log(`预设 ${preset.name}: 已覆盖 ${preset.covered}/${preset.total}，还差 ${preset.missing} 条`);
      }
    }
    return 0;
  }

  if (command === 'diff') {
    const preset = parsePreset(flags.rest[0]);
    for (const target of targetsOf(flags.target)) {
      const file = configFile(flags.base, target);
      if (!existsSync(file)) continue;
      const { add, already } = planPreset(readConfig(file), preset);
      console.log(`\n== ${target}：${preset} 会新增 ${add.length} 条（已有 ${already.length} 条） ==`);
      for (const pattern of add) console.log(`  + ${pattern}`);
    }
    return 0;
  }

  if (command === 'apply') {
    const preset = parsePreset(flags.rest[0]);
    const targets = targetsOf(flags.target).filter((target) => existsSync(configFile(flags.base, target)));
    if (targets.length === 0) throw new Error('没有可处理的配置文件');

    const configs = new Map<Target, ReturnType<typeof readConfig>>();
    for (const target of targets) {
      const config = readConfig(configFile(flags.base, target));
      const guardrails = extractGuardrails(config);
      if (!guardrails.dangerChecker || !guardrails.sandbox) {
        console.error(
          `拒绝批量放行：${target} 的三道闸已被关掉（危险命令检查=${guardrails.dangerChecker}，沙箱=${guardrails.sandbox}）。\n` +
            '先把它们打开，再回来清摩擦；一个批量脚本不该在你没有兜底的时候替你按下确认。',
        );
        return 3;
      }
      configs.set(target, config);
    }

    const pending = [...configs.entries()]
      .map(([target, config]) => ({ target, config, plan: planPreset(config, preset) }))
      .filter((entry) => entry.plan.add.length > 0);

    if (pending.length === 0) {
      console.log(`没有要加的规则：${preset} 已经全部覆盖。`);
      return 0;
    }

    console.log(`预设 ${preset} 将新增：`);
    for (const entry of pending) {
      console.log(`  [${entry.target}] ${entry.plan.add.join('  ')}`);
    }

    if (flags.dryRun) {
      console.log('\n--dry-run：没有写入任何文件。');
      return 0;
    }

    const manifest = snapshot(flags.base, pending.map((entry) => entry.target));
    console.log(`\n已快照：${manifest.id}`);

    for (const entry of pending) {
      writeConfig(configFile(flags.base, entry.target), mergePreset(entry.config, preset));
      console.log(`已写入 ${configFile(flags.base, entry.target)}（+${entry.plan.add.length} 条）`);
    }

    const risky = pending.flatMap((entry) => destructiveAllows(entry.config));
    if (risky.length > 0) {
      console.log(`\n注意：以下破坏性命令原本就是放行状态，本工具没动它们：\n  ${[...new Set(risky)].join('  ')}`);
    }
    console.log('\n重启 WorkBuddy 后生效；不对就 `wb-purge restore ' + manifest.id + '` 一条命令回滚。');
    return 0;
  }

  if (command === 'compact') {
    const targets = targetsOf(flags.target).filter((target) => existsSync(configFile(flags.base, target)));
    if (targets.length === 0) throw new Error('没有可处理的配置文件');

    const pending = targets
      .map((target) => ({ target, config: readConfig(configFile(flags.base, target)) }))
      .map((entry) => ({ ...entry, result: compactConfig(entry.config) }))
      .filter((entry) => entry.result.removed.length > 0);

    if (pending.length === 0) {
      console.log('没有可压缩的冗余规则。');
      return 0;
    }

    for (const entry of pending) {
      console.log(`[${entry.target}] 删除被通配符覆盖的冗余规则 ${entry.result.removed.length} 条：`);
      for (const name of entry.result.removed) console.log(`  - ${name}`);
    }
    if (flags.dryRun) {
      console.log('\n--dry-run：没有写入。');
      return 0;
    }

    const manifest = snapshot(flags.base, pending.map((entry) => entry.target));
    console.log(`\n已快照：${manifest.id}`);
    for (const entry of pending) {
      writeConfig(configFile(flags.base, entry.target), entry.result.config);
    }
    console.log('重启 WorkBuddy 后生效。');
    return 0;
  }

  if (command === 'harden') {
    const targets = targetsOf(flags.target).filter((target) => existsSync(configFile(flags.base, target)));
    if (targets.length === 0) throw new Error('没有可处理的配置文件');

    const pending = targets
      .map((target) => ({ target, config: readConfig(configFile(flags.base, target)) }))
      .map((entry) => ({ ...entry, result: hardenConfig(entry.config) }))
      .filter((entry) => entry.result.changed.length > 0);

    if (pending.length === 0) {
      console.log('没有需要降级的破坏性放行。');
      return 0;
    }

    for (const entry of pending) {
      console.log(`[${entry.target}] 降级为 ask：${entry.result.changed.join('  ')}`);
    }
    if (flags.dryRun) {
      console.log('\n--dry-run：没有写入。');
      return 0;
    }

    const manifest = snapshot(flags.base, pending.map((entry) => entry.target));
    console.log(`\n已快照：${manifest.id}`);
    for (const entry of pending) {
      writeConfig(configFile(flags.base, entry.target), entry.result.config);
      console.log(`已写入 ${configFile(flags.base, entry.target)}`);
    }
    console.log(`\n重启 WorkBuddy 后生效；反悔就 restore ${manifest.id}`);
    return 0;
  }

  if (command === 'snapshots') {
    const manifests = listSnapshots(flags.base);
    if (flags.json) {
      console.log(JSON.stringify(manifests, null, 2));
      return 0;
    }
    if (manifests.length === 0) {
      console.log('还没有快照。');
      return 0;
    }
    for (const manifest of manifests) {
      console.log(`${manifest.id}  ${manifest.createdAt}  ${manifest.files.map((f) => `${f.target}(${f.bytes}B)`).join(' ')}`);
    }
    return 0;
  }

  if (command === 'restore') {
    const id = flags.rest[0];
    if (!id) throw new Error('缺快照 ID，先跑 wb-purge snapshots');
    const restored = restore(flags.base, id, targetsOf(flags.target));
    console.log(`已恢复 ${restored.join(' / ')}（快照 ${id}）`);
    return 0;
  }

  console.error(`未知命令：${command}\n`);
  console.error(USAGE);
  return 2;
}

try {
  process.exitCode = main();
} catch (error) {
  if (error instanceof ZodError) {
    console.error('校验失败：');
    for (const issue of error.issues) {
      console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    }
  } else if (error instanceof Error) {
    console.error(`失败：${error.message}`);
  } else {
    console.error('失败：未知错误');
  }
  process.exitCode = 2;
}
