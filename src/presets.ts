/** 预设只做一件事：把「只读 / 构建 / 测试」这类必然安全的命令从弹窗里拿掉。 */

export const PRESET_NAMES = ['strict', 'fast'] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

const STRICT_PATTERNS = [
  'ls *',
  'cat *',
  'head *',
  'tail *',
  'wc *',
  'grep *',
  'sort *',
  'uniq *',
  'date *',
  'pwd *',
  'env *',
  'basename *',
  'dirname *',
  'which *',
  'file *',
  'stat *',
  'du *',
  'df *',
] as const;

const FAST_PATTERNS = [
  ...STRICT_PATTERNS,
  'node *',
  'npm *',
  'npx *',
  'tsc *',
  'python3 *',
  'pip3 *',
  'uv *',
  'pytest *',
  'make *',
  'jq *',
  'rg *',
  'mkdir *',
  'cp *',
  'mv *',
  'tar *',
  'zip *',
  'unzip *',
  'git status *',
  'git diff *',
  'git log *',
  'git branch *',
  'gh *',
] as const;

export const PRESETS: Record<PresetName, readonly string[]> = {
  strict: STRICT_PATTERNS,
  fast: FAST_PATTERNS,
};

/**
 * 永远不会被本工具写成 allow 的命令。破坏性动作要在 app 里逐条授权，
 * 不由一个批量脚本替你按下确认。
 */
export const NEVER_AUTO_ALLOW = [
  'rm',
  'rmdir',
  'kill',
  'pkill',
  'killall',
  'chmod',
  'chown',
  'shutdown',
  'reboot',
  'dd',
  'mkfs',
  'sudo',
  'su',
  'security',
  'curl',
] as const;

export function isDestructivePattern(pattern: string): boolean {
  const head = pattern.trim().split(/\s+/)[0] ?? '';
  const base = head.split('/').pop() ?? head;
  return NEVER_AUTO_ALLOW.includes(base as (typeof NEVER_AUTO_ALLOW)[number]);
}

export function presetPatterns(name: PresetName): readonly string[] {
  return PRESETS[name];
}
