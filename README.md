# wb-purge

WorkBuddy 的「破甲」实装版：清掉重复审批摩擦，保住三道真闸。快照先行，一条命令回滚。

## 为什么不直接装 dsh-purge

[dsh-purge](https://github.com/kingcharleslzy-ai/dsh-purge) 是 **DSH Desktop** 的宿主插件：
86 条补丁写进 DSH 的 `app.asar`，外加每步重贴提示词，拆的是审批弹窗、沙箱拒绝、
以及**模型自己的拒绝倾向**。WorkBuddy 是另一个宿主，那些补丁没有一条能生效。

能移植的是权限配置这一层——它本来就是 JSON，而且 WorkBuddy 已经把它开放成本地文件：

```
~/.trae-cn/permission/global.json
~/.trae-cn/permission/work/global.json
```

本工具把这两个文件当数据管，而不是当文件手改。

## 做 / 不做

| 做 | 不做 |
|---|---|
| 报出 profile、规则数、闸门状态 | 关掉危险命令检查 / 沙箱 |
| 按预设补齐只读、构建、测试类规则 | 把 `rm`/`kill`/`chmod`/`sudo` 写成 allow |
| 写盘前自动快照、SHA256 校验 | 去改 WorkBuddy 安装目录里的宿主文件 |
| 一条命令回滚到写之前 | 拆掉模型的拒绝能力（换 `no-dead-end`） |

## 安装

```bash
git clone <this repo> wb-purge && cd wb-purge
npm install && npm run build
node dist/src/cli.js status
```

作为技能使用：

```bash
cp -R . ~/.workbuddy/skills/wb-purge
node ~/.workbuddy/skills/wb-purge/dist/src/cli.js status
```

## 命令

```bash
wb-purge status  [--target global|work|both] [--json]
wb-purge diff    <strict|fast> [--target ...]
wb-purge apply   <strict|fast> [--dry-run] [--target ...]
wb-purge snapshots [--json]
wb-purge restore <ID> [--target ...]
```

退出码：`0` 成功 / `2` 参数或校验失败 / `3` 闸门被关，拒绝执行。

## 预设

- `strict`：只读命令（`ls/cat/head/tail/grep/wc/sort/date/stat/du/df/…`）。
- `fast`：`strict` + 构建测试链（`node/npm/tsc/python3/pip3/pytest/make/jq/rg`）
  + 文件搬运（`mkdir/cp/mv/tar/zip/unzip`）+ 只读 git（`git status/diff/log/branch`）+ `gh`。

两者都**不含**破坏性命令；`fast` 也不含 `git push`、`npm publish` 这类对外动作。

## 安全契约

- 写盘前必快照，快照写完立刻回读校验 SHA256。
- 恢复前校验 SHA256，被篡改拒绝恢复。
- 读入走 Zod；`passthrough` 保留未知字段，不做破坏性重写。
- 原子写入（临时文件 + rename）。
- 闸门（危险命令检查 / 沙箱 / 复核人）只读，发现被关就退出码 3，不写任何东西。

## 实测（2026-11-21）

```
profile=full_access  已放行规则=43
三道闸：危险命令检查=开 / 沙箱=开 / 复核人=user → 完整
破坏性命令已被放行（7 条）：chmod *  curl *  kill *  killall *  pkill *  rm *  security *
fast: 15/40 已覆盖，还差 25 条
```

## 开发

```bash
npm run typecheck   # tsc --noEmit
npm test            # build + node:test（17 条）
```

## License

MIT
