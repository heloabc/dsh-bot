# @thready-web/dsh-bot

English | [中文](README.zh-CN.md)

Out-of-the-box DSH. This package pins `@deepseek-ai/dsh@0.2.2-rc.1` and inserts `@thready-web/dsh-bot-plugin`.

## Install with npm and start

Node.js 24.9 or newer is required. Install that line from <https://nodejs.org/>, or with `nvm install 24` or `fnm install 24`. When the `node` on your `PATH` is older, set `DSH_NODE` to a 24.9+ binary.

```bash
npm install -g @thready-web/dsh-bot
dsh-bot
```

`npx @thready-web/dsh-bot` starts the same process without a global install.

`npm install` may print audit reports and ask before running install scripts such as `node-pty` and `koffi`. Those come from the pinned DSH package. Skipping the scripts still starts the host and both pages.

The host listens on `127.0.0.1:8787`. The log prints a URL that contains `?token=`. Open that URL first. The official client stores a session cookie for this origin. Then open the workbench at <http://127.0.0.1:8787/dsh-bot/> in the same browser. The workbench reads that cookie. It returns 401 when the cookie is missing, and it ignores `?token=` on its own URL.

`DSH_HOME` defaults to `~/.dsh-bot`. `--home` overrides it. The default profile is `web`, so persona and memory data live in `~/.dsh-bot/profiles/web/session-foundations`. Admin commands take that directory as `--data-dir`, or read `SESSION_FOUNDATIONS_DIR`. `--data-dir` chooses the store for that command. It leaves the running profile where it is.

`DSH_PORT` and `DSH_PROFILE` override the defaults. A flag (`--port`, `--profile`, `--host`, `--home`) overrides the matching variable.

```bash
dsh-bot persona show --data-dir ~/.dsh-bot/profiles/web/session-foundations
dsh-bot memory list --data-dir ~/.dsh-bot/profiles/web/session-foundations --session ID
dsh-bot help
```

## Vision

Explore the most efficient form of collaboration between people and agents, and among agents themselves.

### Where we are

AI has taken three steps:

- AI Chat: AI can answer questions.
- Copilot: AI sits beside you and helps complete the work in your hands.
- Agent: AI can take a whole task and finish it on its own.

We believe the next step is a cluster of bots and agents. A person no longer directs one tool at a time. They work with a group of agents that each have a role, stay online, and collaborate. The person sets direction and judgment. The cluster carries out the work and coordinates it.

This step is not about going a little faster. It raises the ceiling of what productivity can be.

### What we are exploring

DSH Bot has to answer a few questions:

- Human–agent collaboration: How does a person direct the most intelligence with the least attention? When should an agent reply, report, or ask, and when should it work quietly?
- Cluster collaboration: How do agents divide work, hand it off, correct each other, and run in parallel without dragging one another down?
- Staying present: A bot has a persona, memory, and skills. Messages, schedules, and events can wake it. It is a long-term partner, not a one-off conversation.
- Reliable delivery: Every assignment has a ledger. It can be interrupted, reassigned, and resumed, and it ends in the person's hands.

These directions are still new. Each one is worth digging into.

### Why start from DSH

DSH already has a thriving ecosystem. The starting point is high, and extension is flexible.

The agent loop is already built. We are not rebuilding that wheel. The effort goes into what matters: the paradigm of human–agent collaboration itself.

### Not bound to any foundation

We start from DSH. We do not promise to stay bound to it.

If we one day need a deeper capability that DSH cannot provide, we will go further down.

If a more elegant form of people and agents living together appears beyond the chat bot, we will go forward.

Tools will change. Forms will change. The goal stays the same: people and agents, together, doing the work as well as it can be done.
