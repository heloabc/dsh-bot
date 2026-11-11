#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { ADMIN_SUMMARY, START_HELP, planStart, route } from './lib/launch.js'

const argv = process.argv.slice(2)
const routed = route(argv)

if (routed.kind === 'help' || routed.kind === 'unknown') {
  const text = await helpText()
  if (routed.kind === 'unknown') {
    console.error(`Unknown command: ${routed.argv[0] ?? ''}\n\n${text}`)
    process.exit(2)
  }
  console.log(text)
  process.exit(0)
}

if (routed.kind === 'admin') {
  let run
  try {
    ;({ run } = await import('@thready-web/dsh-bot-plugin/cli'))
  } catch {
    console.error('The bot plugin CLI is not built. Run npm run build:bot.')
    process.exit(1)
  }
  await run(routed.argv, { program: 'dsh-bot' })
  process.exit(process.exitCode ?? 0)
}

const require = createRequire(import.meta.url)
let dshPkg = ''
let pluginPkg = ''
try {
  dshPkg = require.resolve('@deepseek-ai/dsh/package.json')
  pluginPkg = require.resolve('@thready-web/dsh-bot-plugin/package.json')
} catch {
  console.error('Install dependencies so @deepseek-ai/dsh@0.2.2-rc.1 and @thready-web/dsh-bot-plugin resolve.')
  process.exit(1)
}

const node = process.env.DSH_NODE || process.execPath
const nodeVersion = readNodeVersion(node)
if (nodeVersion === '') {
  console.error(`Could not read the Node version from ${node}`)
  process.exit(1)
}

const plan = planStart({
  argv: routed.argv,
  env: process.env,
  pluginRoot: dirname(pluginPkg),
  dshBin: join(dirname(dshPkg), 'lib/bin.js'),
  nodePath: node,
  nodeVersion,
})
if (!plan.ok) {
  console.error(plan.message)
  process.exit(1)
}

mkdirSync(plan.home, { recursive: true })
mkdirSync(plan.workspace, { recursive: true, mode: 0o700 })
writeFileSync(plan.patchFile, plan.patch)
console.log(`DSH profile ${plan.profile} on http://${plan.host}:${plan.port}/`)
console.log(`Workbench http://${plan.host}:${plan.port}/dsh-bot/`)
console.log(`DSH_HOME ${plan.home}`)
console.log(`Workspace ${plan.workspace}`)
if (plan.env.DSH_BOT_WORK_BUDGET) console.log(`Work budget ${plan.env.DSH_BOT_WORK_BUDGET}`)

const child = spawn(plan.node, plan.args, {
  cwd: plan.workspace,
  env: {
    ...process.env,
    ...plan.env,
    DSH_HOME: plan.home,
    DSH_TELEMETRY_DISABLED: '1',
  },
  stdio: 'inherit',
})

const stop = (signal) => {
  if (child.exitCode == null) child.kill(signal)
}
process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
child.on('exit', (code) => process.exit(code ?? 0))

async function helpText() {
  try {
    const { usage } = await import('@thready-web/dsh-bot-plugin/cli')
    return `${START_HELP}\n${usage('dsh-bot')}\n`
  } catch {
    return `${START_HELP}\n${ADMIN_SUMMARY}`
  }
}

/**
 * @param {string} node
 */
function readNodeVersion(node) {
  if (node === process.execPath) return process.versions.node
  const result = spawnSync(node, ['-p', 'process.versions.node'], { encoding: 'utf8' })
  if (result.status !== 0) return ''
  return result.stdout.trim()
}
