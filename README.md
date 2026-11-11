# @thready-web/dsh-bot

Out-of-the-box DSH. This package pins `@deepseek-ai/dsh@0.2.2-rc.1` and inserts `@thready-web/dsh-bot-plugin`. It does not insert the math guard or the Ollama usage panel.

```bash
dsh-bot
```

The official client is <http://127.0.0.1:8787/>. The workbench is <http://127.0.0.1:8787/dsh-bot/>. `DSH_HOME` defaults to `~/.dsh-bot`.

Node.js `>= 24.9` is required to start the host. `DSH_NODE` selects that binary when the current Node is older. `DSH_PORT` and `DSH_PROFILE` override the defaults. A flag (`--port`, `--profile`, `--host`, `--home`) overrides the matching variable.

Admin commands use the same binary:

```bash
dsh-bot persona show --data-dir DIR
dsh-bot memory list --data-dir DIR --session ID
dsh-bot help
```

From this repository, build the plugin and the workbench before the first start:

```bash
npm run build:bot
npm --prefix plugins/dsh-bot-plugin/ui install
npm --prefix plugins/dsh-bot-plugin/ui run build
npx dsh-bot
```

`npm run dev` at the repository root still starts a profile that also inserts the math guard and the usage panel. That script reads `DSH_BIN` and keeps its data in `.run/dsh-home`.
