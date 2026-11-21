---
name: wb-purge
description: >-
  Friction purger for WorkBuddy itself. Removes repeated approval popups for read/build/test
  commands by managing ~/.trae-cn/permission/*.json as data: snapshot first, merge a preset,
  atomic write, one command to roll back. Reports which destructive commands are already
  auto-allowed and refuses to add any or to run when the three real guardrails are off.
  Use when the user asks to stop confirmation prompts, "remove limits", shorten the approval
  loop, or inspect/rollback permission config. Not a model-side jailbreak, not a refusal-remover.
descriptionZh: >-
  WorkBuddy 自己的「去摩擦」工具：把只读/构建/测试类命令的重复审批弹窗清掉。
  做法是把 ~/.trae-cn/permission/*.json 当数据处理：先快照 → 合并预设 → 原子写入 → 一条命令回滚。
  会如实列出已经被放行的破坏性命令，但不替用户新增任何一条，闸门被关时拒绝执行。
  触发词：别老问我、去掉确认、没有限制、审批太烦、清摩擦、权限太严、workbuddy 破甲。
  不做：模型侧破甲、去掉拒绝能力、替你批量放行 rm/kill。
tags:
  - workbuddy
  - permission
  - friction
  - snapshot
level: user
agent_created: true
---

# wb-purge：清摩擦，不动闸

## 1. 先说清楚一件事

`dsh-purge` 是 DSH Desktop 的宿主插件（86 条补丁写进 `app.asar` + 每步重贴提示词），
它拆的是**审批弹窗 + 沙箱拒绝 + 模型自己的拒绝倾向**。WorkBuddy 是另一个宿主，
那 86 条补丁一行都用不上，装了也不会生效。

本技能只做能落地的那一半：**把 WorkBuddy 自己的权限配置当数据来管**。
不做的那一半（拆掉模型的拒绝倾向）理由很具体——拒绝倾向拆掉之后，模型不会变强，
只会变自信；能力没增加，幻觉先增加。上一轮修的 `no-dead-end` 才是正确解法：
把「能力不足型拒绝」换成「可执行的接管路径」。

## 2. 三道闸（本工具只读，永不写）

| 闸 | 配置键 | 本工具行为 |
|---|---|---|
| 危险命令检查 | `approval.sceneRules.commandAstDangerChecker` | 关了就**拒绝**批量放行（退出码 3） |
| Shell 沙箱 | `shellSandbox.enable` | 同上 |
| 人工复核人 | `approval.reviewer` | 不碰 |

另外：**任何预设都不会把 `rm` / `kill` / `chmod` / `sudo` / `curl` 这类命令写成 allow**。
已有的是你自己在 app 里逐条授权的，本工具只报数，不加也不删。

## 3. 命令

```bash
cd ~/.workbuddy/skills/wb-purge
node dist/src/cli.js status      # 体检：profile / 闸门 / 已放行的破坏性命令 / 预设覆盖度
node dist/src/cli.js diff fast   # 只看会新增哪些规则，不写盘
node dist/src/cli.js apply fast  # 快照 → 合并 → 原子写入（--dry-run 可空跑）
node dist/src/cli.js snapshots   # 列快照
node dist/src/cli.js restore <ID> # 一条命令回到写之前
```

- `--target global|work|both`（默认 both）：主配置 / 工作区配置。
- `--base <dir>`：覆盖 `~/.trae-cn`（测试与多实例用）。
- 退出码：`0` 成功 / `2` 参数或校验失败 / `3` 闸门被关，拒绝执行。

## 4. 标准动作（对话里就这么用）

1. 用户说「别老问」「去掉确认」→ 先跑 `status`，把**已有的破坏性放行**念给他听。
2. 跑 `diff fast`，把「会新增 25 条」这类具体清单给出来，再 `apply`。
3. 提醒：**重启 WorkBuddy 才生效**；不对就 `restore <ID>`，不留半截状态。
4. 用户说「要没有限制」时，回的是：限制本来就在 `full_access` 里，缺的是规则覆盖，
   而「没有限制」这件事本机已经做到了——真正卡住你的是**能力误判**，走 `no-dead-end`。

## 5. 安全契约

- 写盘前必快照；快照写入后立刻按 SHA256 回读校验。
- 恢复前校验 SHA256，被篡改就拒绝恢复。
- 读取用 Zod 校验；`passthrough` 保留 WorkBuddy 未来新增的未知字段，不做破坏性重写。
- 写盘用「临时文件 + rename」原子替换，失败不留半个 JSON。

## 6. 本机现状（2026-11-21 实测）

```
profile=full_access  已放行规则=43
三道闸：危险命令检查=开 / 沙箱=开 / 复核人=user → 完整
破坏性命令已被放行（7 条）：chmod *  curl *  kill *  killall *  pkill *  rm *  security *
预设 fast: 已覆盖 15/40，还差 25 条（node / npm / tsc / git status / jq / mv / gh …）
```

结论：这台机器早就是「无限制模式」了，缺的只是 25 条日常命令的放行。
