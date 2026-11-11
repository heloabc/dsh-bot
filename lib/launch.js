import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Environment variable the plugin reads for main/worker budget overrides. */
export const WORK_BUDGET_ENV = 'DSH_BOT_WORK_BUDGET'

const BUDGET_KEYS = [
  'mainMaxSteps', 'mainWallMs', 'chatMaxSteps', 'chatWallMs', 'holdMs', 'workerMaxSteps',
  'workerWallMs', 'workerMaxTokens', 'perBot', 'global', 'leaseMs', 'starveMs', 'mergeWindowMs',
]

/**
 * Validate `--work-budget`. Accepts JSON or `key=value` pairs separated by commas.
 * `steps` and `wall` set both the chat and main caps; `*Ms` keys and `wall`
 * accept durations such as `90s`, `30m`, `2h`. The plugin parses the same text.
 * @param {string} text
 * @returns {{ ok: true, value: string } | { ok: false, message: string }}
 */
export function checkWorkBudget(text) {
  const source = String(text ?? '').trim()
  if (source === '' || source === 'true') return { ok: false, message: '--work-budget needs a value, for example steps=80,wall=30m' }
  /** @type {Record<string, unknown>} */
  let object = {}
  if (source.startsWith('{')) {
    try {
      object = JSON.parse(source)
    } catch {
      return { ok: false, message: `--work-budget is not valid JSON: ${source}` }
    }
  } else {
    for (const part of source.split(',')) {
      const piece = part.trim()
      if (piece === '') continue
      const eq = piece.indexOf('=')
      if (eq <= 0) return { ok: false, message: `--work-budget expects key=value, got ${piece}` }
      object[piece.slice(0, eq).trim()] = piece.slice(eq + 1).trim()
    }
  }
  for (const [key, value] of Object.entries(object)) {
    if (key !== 'steps' && key !== 'wall' && !BUDGET_KEYS.includes(key)) {
      return { ok: false, message: `--work-budget has an unknown key ${key}` }
    }
    const duration = key === 'wall' || key.endsWith('Ms')
    const ok = duration
      ? /^\s*\d+(?:\.\d+)?\s*(?:ms|s|m|h)?\s*$/i.test(String(value)) && Number.parseFloat(String(value)) > 0
      : Number.isFinite(Number(value)) && Number(value) > 0
    if (!ok) return { ok: false, message: `--work-budget ${key} must be a positive ${duration ? 'duration' : 'number'}` }
  }
  return { ok: true, value: source }
}

export const ADMIN_COMMANDS = [
  'persona',
  'session',
  'memory',
  'skill',
  'message',
  'work',
  'timer',
  'webhook',
  'status',
  'backup',
  'restore',
]

const PLUGIN_FILES = [
  'dist/router-plugin.js',
  'dist/index.js',
  'dist/http-plugin.js',
  'public/index.html',
]

/**
 * @param {string[]} argv
 */
export function route(argv) {
  const head = argv[0]
  if (head == null || head === 'start') {
    return { kind: 'start', argv: head == null ? [] : argv.slice(1) }
  }
  if (head === 'help' || head === '--help' || head === '-h') return { kind: 'help' }
  if (ADMIN_COMMANDS.includes(head)) return { kind: 'admin', argv }
  if (head.startsWith('--')) return { kind: 'start', argv }
  return { kind: 'unknown', argv }
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @param {string} [home]
 */
export function defaultHome(env = process.env, home = homedir()) {
  if (env.DSH_HOME != null && env.DSH_HOME !== '') return env.DSH_HOME
  return join(home, '.dsh-bot')
}

/**
 * @param {string} version
 */
export function nodeSatisfies(version) {
  const match = /^v?(\d+)\.(\d+)/.exec(String(version).trim())
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2])
  return major > 24 || (major === 24 && minor >= 9)
}

/**
 * Absolute paths DSH loads. The patch does not name the package, so DSH does not resolve the workspace.
 * @param {string} pluginRoot
 */
export function renderPatch(pluginRoot) {
  const file = (rel) => JSON.stringify(join(pluginRoot, rel))
  return `- insert:
    - id: ui-router
      name: ${file('dist/router-plugin.js')}
    - id: session-foundations
      name: ${file('dist/index.js')}
    - id: session-foundations-http
      name: ${file('dist/http-plugin.js')}
`
}

/**
 * @param {string} pluginRoot
 */
export function missingPluginFiles(pluginRoot) {
  return PLUGIN_FILES.filter((rel) => !existsSync(join(pluginRoot, rel))).map((rel) => join(pluginRoot, rel))
}

/**
 * @param {string[]} argv
 */
function flagsOf(argv) {
  /** @type {Record<string, string>} */
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const body = token.slice(2)
    const eq = body.indexOf('=')
    if (eq !== -1) {
      out[body.slice(0, eq)] = body.slice(eq + 1)
      continue
    }
    const value = argv[i + 1]
    if (value == null || value.startsWith('--')) out[body] = 'true'
    else {
      out[body] = value
      i += 1
    }
  }
  return out
}

/**
 * Decide how to start, without spawning DSH or writing the patch file.
 * @param {{
 *   argv?: string[],
 *   env?: Record<string, string | undefined>,
 *   pluginRoot: string,
 *   dshBin: string,
 *   nodePath: string,
 *   nodeVersion: string,
 *   homeDir?: string,
 * }} input
 */
export function planStart(input) {
  const env = input.env ?? {}
  if (!nodeSatisfies(input.nodeVersion)) {
    return {
      ok: false,
      message: `Node >= 24.9 is required to start DSH. This Node is ${input.nodeVersion}. Set DSH_NODE to a newer binary.`,
    }
  }
  if (!input.dshBin || !existsSync(input.dshBin)) {
    return {
      ok: false,
      message: 'Could not find @deepseek-ai/dsh@0.2.2-rc.1 lib/bin.js. Install dependencies from the repository root.',
    }
  }
  const missing = missingPluginFiles(input.pluginRoot)
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Missing ${missing.join(', ')}. Run npm run build:bot and npm --prefix plugins/dsh-bot-plugin/ui run build`,
    }
  }
  const flags = flagsOf(input.argv ?? [])
  const profile = flags.profile || env.DSH_PROFILE || 'web'
  const host = flags.host || '127.0.0.1'
  const port = flags.port || env.DSH_PORT || '8787'
  const home = flags.home || defaultHome(env, input.homeDir)
  const patch = renderPatch(input.pluginRoot)
  const patchFile = join(home, 'dsh-bot.patch.yml')
  // Sessions and the DSH process start here, never in DSH_HOME itself
  // (owner token, profiles, persona.sqlite).
  const workspace = resolve(flags.workspace || env.THREADY_SESSION_CWD || join(home, 'workspace'))
  /** @type {Record<string, string>} */
  const childEnv = { THREADY_SESSION_CWD: workspace }
  const budgetText = flags['work-budget'] ?? env[WORK_BUDGET_ENV]
  if (budgetText != null && budgetText !== '') {
    const checked = checkWorkBudget(budgetText)
    if (!checked.ok) return { ok: false, message: checked.message }
    childEnv[WORK_BUDGET_ENV] = checked.value
  }
  return {
    ok: true,
    node: input.nodePath,
    profile,
    host,
    port: String(port),
    home,
    workspace,
    env: childEnv,
    patch,
    patchFile,
    args: [
      input.dshBin,
      '--profile', profile,
      '--patch', patchFile,
      '--host', host,
      '--port', String(port),
      '--no-open',
    ],
  }
}

export const START_HELP = `dsh-bot
dsh-bot start [--host HOST] [--port PORT] [--profile NAME] [--home DIR] [--workspace DIR] [--work-budget SPEC]

Starts @deepseek-ai/dsh@0.2.2-rc.1 with the bot plugin already inserted.
The official client is http://127.0.0.1:8787/ and the workbench is http://127.0.0.1:8787/dsh-bot/.

Defaults: --profile web --host 127.0.0.1 --port 8787 --no-open.
DSH_HOME defaults to ~/.dsh-bot. DSH_PORT, DSH_PROFILE, and DSH_NODE override those defaults when the flag is omitted.
A flag overrides the matching environment variable.

--workspace DIR     Session working directory. Default THREADY_SESSION_CWD, else DSH_HOME/workspace.
--work-budget SPEC  Bot main-session budget, e.g. steps=80,wall=30m (the default) or
                    steps=120,wall=45m,mainMaxSteps=10. Also DSH_BOT_WORK_BUDGET.
`

export const ADMIN_SUMMARY = `Admin commands:
  persona, session, memory, skill, message, work, timer, webhook, status, backup, restore
Pass --data-dir or set SESSION_FOUNDATIONS_DIR. Build the plugin with npm run build:bot to print each command's flags.
`
