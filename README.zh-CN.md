# @thready-web/dsh-bot

[English](README.md) | 中文

开箱即用的 DSH。这个包钉住 `@deepseek-ai/dsh@0.2.2-rc.1`，并插入 `@thready-web/dsh-bot-plugin`。

## 用 npm 安装并启动

需要 Node.js 24.9 或更高。从 <https://nodejs.org/> 安装 24.x，或执行 `nvm install 24`、`fnm install 24`。`PATH` 上的 `node` 更旧时，把 `DSH_NODE` 指到 24.9 以上的可执行文件。

```bash
npm install -g @thready-web/dsh-bot
dsh-bot
```

`npx @thready-web/dsh-bot` 不安装全局命令，启动的是同一个进程。

`npm install` 可能会打印漏洞报告，并在运行 `node-pty`、`koffi` 这类安装脚本前征求同意。这些依赖来自钉住的 DSH 包。跳过这些脚本，宿主和两个页面仍然能启动。

宿主监听 `127.0.0.1:8787`。日志里会打印一条带 `?token=` 的地址。先打开这条地址，官方客户端会为这个来源写入会话 cookie。然后在同一个浏览器打开工作台 <http://127.0.0.1:8787/dsh-bot/>。工作台读取这枚 cookie。没有 cookie 时返回 401。只把 `?token=` 加在工作台地址上不会通过鉴权。

`DSH_HOME` 默认是 `~/.dsh-bot`。`--home` 覆盖它。默认 profile 是 `web`，人设和记忆在 `~/.dsh-bot/profiles/web/session-foundations`。管理命令用 `--data-dir` 指定这个目录，或读取 `SESSION_FOUNDATIONS_DIR`。`--data-dir` 只选择这条命令要打开的库，不移动正在运行的 profile。

`DSH_PORT` 和 `DSH_PROFILE` 覆盖默认值。标志（`--port`、`--profile`、`--host`、`--home`）覆盖对应的环境变量。

```bash
dsh-bot persona show --data-dir ~/.dsh-bot/profiles/web/session-foundations
dsh-bot memory list --data-dir ~/.dsh-bot/profiles/web/session-foundations --session ID
dsh-bot help
```

## DSH Bot 愿景

探索人与智能体、智能体与智能体之间协作的最高效形态。

### 我们走到了哪里

AI 走过了三步：

- AI Chat：AI 能回答问题。
- Copilot：AI 在你身边，帮你补全手上的活。
- Agent：AI 可以接过一整件任务，独立做完。

我们相信下一步是 Bot 与 Agent 集群。人不再一次只差遣一个工具，而是和一群各有分工、长期在线、彼此协作的智能体一起工作。人负责方向和判断，集群负责执行和协同。

这一步不是再快一点，而是生产力上限的打开。

### 我们要探索什么

DSH Bot 要回答几个问题：

- 人机协作：人怎样用最少的注意力调动最多的智能？什么时候该回话、汇报、追问，什么时候该安静地干活？
- 集群协作：多个智能体怎样分工、交接、纠错、并行，而不互相拖累？
- 持续在场：Bot 拥有人格、记忆与技能，能被消息、定时和事件唤醒，成为长期的伙伴，而不是一次性的对话。
- 可靠交付：每一项委托都有账可查，可以中断，可以改派，可以恢复，最后交付到人手里。

这些方向都还很新，每一个都值得认真深挖。

### 为什么从 DSH 开始

DSH 已经有足够繁荣的生态。它起点高，扩展也灵活。

Agent loop 已经有人做好了，我们不再重复造轮子，把全部精力投入真正重要的事：人机协作的范式本身。

### 不被任何底座绑定

我们从 DSH 出发，但不承诺永远和它绑定。

如果有一天我们需要更深的底层能力，而 DSH 无法提供，我们会向下走。

如果有一天出现比 chat bot 更优雅的人机共生形态，我们会向前走。

工具会变，形态会变，目标不变：让人与智能体一起，把事情做到最好。
