import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { checkWorkBudget, defaultHome, planStart, renderPatch, route } from '../lib/launch.js'

test('no args and start launch the host', () => {
  assert.equal(route([]).kind, 'start')
  assert.deepEqual(route(['start', '--port', '9000']), { kind: 'start', argv: ['--port', '9000'] })
  assert.equal(route(['--port', '9000']).kind, 'start')
})

test('admin commands keep their argv', () => {
  for (const command of ['persona', 'session', 'memory', 'skill', 'message', 'work', 'timer', 'webhook', 'status', 'backup', 'restore']) {
    const routed = route([command, 'show', '--data-dir', '/tmp/bot'])
    assert.equal(routed.kind, 'admin')
    assert.deepEqual(routed.argv, [command, 'show', '--data-dir', '/tmp/bot'])
  }
})

test('help and unknown commands stay out of the admin runner', () => {
  assert.equal(route(['help']).kind, 'help')
  assert.equal(route(['--help']).kind, 'help')
  assert.equal(route(['-h']).kind, 'help')
  assert.equal(route(['nope']).kind, 'unknown')
})

test('the patch names the three bot plugin files and nothing else', () => {
  const root = '/plugins/dsh-bot-plugin'
  const patch = renderPatch(root)
  for (const file of ['dist/router-plugin.js', 'dist/index.js', 'dist/http-plugin.js']) {
    assert.match(patch, new RegExp(JSON.stringify(join(root, file)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(patch, /id: ui-router/)
  assert.match(patch, /id: session-foundations\n/)
  assert.match(patch, /id: session-foundations-http/)
  assert.doesNotMatch(patch, /math-guard|ollama/)
})

test('the default home is ~/.dsh-bot', () => {
  assert.equal(defaultHome({}), join(homedir(), '.dsh-bot'))
  assert.equal(defaultHome({ DSH_HOME: '/custom/home' }), '/custom/home')
})

test('a ready tree plans a start without spawning DSH', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bot-'))
  const pluginRoot = join(dir, 'plugin')
  mkdirSync(join(pluginRoot, 'dist'), { recursive: true })
  mkdirSync(join(pluginRoot, 'public'), { recursive: true })
  for (const file of ['dist/router-plugin.js', 'dist/index.js', 'dist/http-plugin.js', 'public/index.html']) {
    writeFileSync(join(pluginRoot, file), '')
  }
  const dshBin = join(dir, 'bin.js')
  writeFileSync(dshBin, '')
  const plan = planStart({
    argv: ['--port', '9000'],
    env: { DSH_PORT: '1', DSH_PROFILE: 'lab' },
    pluginRoot,
    dshBin,
    nodePath: '/usr/local/bin/node',
    nodeVersion: '24.9.0',
    homeDir: '/Users/someone',
  })
  assert.equal(plan.ok, true)
  assert.equal(plan.home, join('/Users/someone', '.dsh-bot'))
  assert.equal(plan.port, '9000')
  assert.equal(plan.profile, 'lab')
  assert.equal(plan.args.at(-1), '--no-open')
  assert.match(plan.patch, new RegExp(JSON.stringify(join(pluginRoot, 'dist/index.js')).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('Node older than 24.9 does not start', () => {
  const plan = planStart({
    pluginRoot: '/missing',
    dshBin: '/missing/bin.js',
    nodePath: process.execPath,
    nodeVersion: '22.18.0',
  })
  assert.equal(plan.ok, false)
  assert.match(plan.message, /24\.9/)
})

test('a missing workbench build is reported and does not start', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bot-'))
  const pluginRoot = join(dir, 'plugin')
  mkdirSync(join(pluginRoot, 'dist'), { recursive: true })
  for (const file of ['dist/router-plugin.js', 'dist/index.js', 'dist/http-plugin.js']) {
    writeFileSync(join(pluginRoot, file), '')
  }
  const dshBin = join(dir, 'bin.js')
  writeFileSync(dshBin, '')
  const plan = planStart({
    pluginRoot,
    dshBin,
    nodePath: process.execPath,
    nodeVersion: 'v24.22.2',
  })
  assert.equal(plan.ok, false)
  assert.match(plan.message, /public\/index\.html/)
  assert.match(plan.message, /dsh-bot-plugin\/ui/)
})

function readyTree() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bot-'))
  const pluginRoot = join(dir, 'plugin')
  mkdirSync(join(pluginRoot, 'dist'), { recursive: true })
  mkdirSync(join(pluginRoot, 'public'), { recursive: true })
  for (const file of ['dist/router-plugin.js', 'dist/index.js', 'dist/http-plugin.js', 'public/index.html']) {
    writeFileSync(join(pluginRoot, file), '')
  }
  const dshBin = join(dir, 'bin.js')
  writeFileSync(dshBin, '')
  return { dir, pluginRoot, dshBin }
}

test('sessions and DSH start in <home>/workspace, not in DSH_HOME', () => {
  const { pluginRoot, dshBin } = readyTree()
  const base = { pluginRoot, dshBin, nodePath: process.execPath, nodeVersion: '24.9.0' }
  const plan = planStart({ ...base, argv: ['--home', '/srv/bot'], env: {} })
  assert.equal(plan.ok, true)
  assert.equal(plan.workspace, '/srv/bot/workspace')
  assert.notEqual(plan.workspace, plan.home)
  assert.equal(plan.env.THREADY_SESSION_CWD, '/srv/bot/workspace')
  assert.equal(planStart({ ...base, argv: ['--home', '/srv/bot'], env: { THREADY_SESSION_CWD: '/data/ws' } }).workspace, '/data/ws')
  assert.equal(
    planStart({ ...base, argv: ['--home', '/srv/bot', '--workspace', '/w'], env: { THREADY_SESSION_CWD: '/data/ws' } }).workspace,
    '/w',
  )
})

test('--work-budget is checked and passed to the plugin through DSH_BOT_WORK_BUDGET', () => {
  const { pluginRoot, dshBin } = readyTree()
  const base = { pluginRoot, dshBin, nodePath: process.execPath, nodeVersion: '24.9.0', env: {} }
  assert.equal(planStart({ ...base, argv: [] }).env.DSH_BOT_WORK_BUDGET, undefined)
  const plan = planStart({ ...base, argv: ['--work-budget', 'steps=120,wall=45m,mainMaxSteps=10'] })
  assert.equal(plan.ok, true)
  assert.equal(plan.env.DSH_BOT_WORK_BUDGET, 'steps=120,wall=45m,mainMaxSteps=10')
  const json = planStart({ ...base, argv: ['--work-budget={"chatWallMs":"2h"}'] })
  assert.equal(json.env.DSH_BOT_WORK_BUDGET, '{"chatWallMs":"2h"}')
  assert.equal(planStart({ ...base, env: { DSH_BOT_WORK_BUDGET: 'steps=50' }, argv: [] }).env.DSH_BOT_WORK_BUDGET, 'steps=50')
  for (const bad of ['steps=0', 'wall=soon', 'bogus=1', 'steps', '{oops']) {
    const refused = planStart({ ...base, argv: ['--work-budget', bad] })
    assert.equal(refused.ok, false, bad)
    assert.match(refused.message, /--work-budget/)
  }
  assert.equal(checkWorkBudget('steps=80,wall=30m').ok, true)
})
