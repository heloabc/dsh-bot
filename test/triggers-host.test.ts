import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

const ROOT = new URL('..', import.meta.url).pathname
const NODE = process.env.DSH_NODE
  ?? (existsSync(`${homedir()}/.nvm/versions/node/v24.22.2/bin/node`) ? `${homedir()}/.nvm/versions/node/v24.22.2/bin/node` : process.execPath)
const DSH = process.env.DSH_BIN
  ?? (existsSync('/tmp/dsh-probe/node_modules/@deepseek-ai/dsh/lib/bin.js') ? '/tmp/dsh-probe/node_modules/@deepseek-ai/dsh/lib/bin.js' : '')

test('real DSH inbox: message, busy, cold resume, crash, webhook, timer', { timeout: 180000 }, async () => {
  assert.ok(DSH && existsSync(DSH))
  const pkg = JSON.parse(readFileSync(join(DSH, '../../package.json'), 'utf8'))
  assert.equal(pkg.version, '0.2.2-rc.1')
  const home = mkdtempSync(join(tmpdir(), 'sf-trig-home-'))
  const work = mkdtempSync(join(tmpdir(), 'sf-trig-work-'))
  const patch = join(work, 'patch.yml')
  writeFileSync(patch, `
- id: agent-default-model
  config:
    provider: foundations-mock
    model: mock-1
- insert:
    - id: foundations-mock
      name: ${JSON.stringify(join(ROOT, 'fixtures/mock-llm.mjs'))}
    - id: session-foundations
      name: ${JSON.stringify(join(ROOT, 'dist/index.js'))}
      config:
        traceEvents: true
        contextWindow: 128000
        timerTickMs: 400
    - id: session-foundations-http
      name: ${JSON.stringify(join(ROOT, 'dist/http-plugin.js'))}
`)
  const port = 31992
  const origin = `http://127.0.0.1:${port}`
  const evidence: {
    mock: boolean
    realLlm: boolean
    dsh: string
    inbox: string
    [key: string]: unknown
  } = { mock: true, realLlm: false, dsh: pkg.version, inbox: 'agent.followup next-turn' }
  const env: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', HOME: home, PATH: process.env.PATH }
  delete env.SESSION_FOUNDATIONS_CRASH_BEFORE_FLUSH
  let child = start(env, patch, port, join(work, 'dsh-1.log'))
  let sessionA = ''
  let sessionB = ''
  try {
    const cookie = await boot(child, join(work, 'dsh-1.log'), origin)
    sessionA = await makeSession(origin, cookie, work)
    sessionB = await makeSession(origin, cookie, work)
    await plugin(origin, cookie, '/session-foundations/api/messages/allow', { targetSessionId: sessionB, senderSessionId: sessionA })
    await plugin(origin, cookie, '/session-foundations/api/messages/allow', { targetSessionId: sessionA, senderSessionId: sessionB })
    const denied = await plugin(origin, cookie, '/session-foundations/api/messages/send', {
      senderSessionId: 'session-stranger',
      targetSessionId: sessionB,
      text: 'no',
      idempotencyKey: 'deny-1',
    }).catch(error => error)
    assert.match(String(denied.message ?? denied.code ?? ''), /FORBIDDEN|400/)

    await promptAndWait(origin, cookie, sessionA, `FOUNDATIONS_TOOL foundations_send ${JSON.stringify({
      targetSessionId: sessionB,
      text: 'ordinary',
      idempotencyKey: 'tool-1',
      sessionId: sessionB,
    })}`)
    const forged = await pluginGet(origin, cookie, `/session-foundations/api/deliveries?sessionId=${encodeURIComponent(sessionA)}`)
    const forgedRow = forged.deliveries.find((row: any) => row.sender_session_id === sessionA && row.hop === 1 && row.kind === 'message')
    assert.ok(forgedRow)
    assert.equal(forgedRow.sender_session_id, sessionA)
    assert.notEqual(forgedRow.sender_session_id, sessionB)
    evidence.forgedSenderIgnored = true

    const relay = await plugin(origin, cookie, '/session-foundations/api/messages/send', {
      senderSessionId: sessionA,
      targetSessionId: sessionB,
      text: 'relay',
      idempotencyKey: 'relay-1',
    })
    assert.equal(relay.status === 'accepted' || relay.status === 'claimed' || relay.status === 'started' || relay.status === 'completed', true)
    const chain = await poll(async () => {
      const page = await pluginGet(origin, cookie, `/session-foundations/api/deliveries?correlationId=${encodeURIComponent(relay.correlationId)}`)
      const hops = page.deliveries.filter((row: any) => row.kind === 'message')
      const rejected = hops.some((row: any) => row.status === 'rejected')
      return rejected ? hops : null
    })
    evidence.hops = chain.map((row: any) => ({ hop: row.hop, status: row.status, from: row.sender_session_id, to: row.target_session_id }))
    assert.ok(chain.some((row: any) => row.hop === 2 && row.sender_session_id === sessionB && row.target_session_id === sessionA))
    assert.ok(chain.some((row: any) => row.status === 'rejected' && row.hop === 5))
    assert.equal(chain.some((row: any) => row.hop > 5 && row.status === 'accepted'), false)

    await prompt(origin, cookie, sessionA, 'FOUNDATIONS_DELAY 1200')
    await delay(200)
    const busy = await plugin(origin, cookie, '/session-foundations/api/messages/send', {
      senderSessionId: sessionB,
      targetSessionId: sessionA,
      text: 'queue while busy',
      idempotencyKey: 'busy-1',
    })
    await rpc(origin, cookie, 'session/wait', { request: { sessionId: sessionA, timeoutMs: 20000 } })
    const eventsA = await eventsOf(origin, cookie, sessionA)
    const splices = eventsA.filter((event: any) => event!.type === 'agent/inbox/spliced' && JSON.stringify(event!.data).includes(busy.deliveryId))
    assert.ok(splices.length >= 1)
    assert.equal(splices.every((event: any) => event!.data?.target === 'next-turn'), true)
    evidence.busyTarget = splices.map((event: any) => event!.data?.target)

    const hook = await plugin(origin, cookie, '/session-foundations/api/webhooks', { targetSessionId: sessionA })
    const secret = readFileSync(hook.hook.secretFile, 'utf8')
    assert.equal(JSON.stringify(hook).includes(secret), false)
    const raw = Buffer.from('{"ping":1}')
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = createHmac('sha256', secret).update(`${timestamp}.${raw.toString('utf8')}`).digest('hex')
    const first = await hookPost(origin, cookie, hook.hook.id, raw, { timestamp, signature, eventId: 'evt-1' })
    const second = await hookPost(origin, cookie, hook.hook.id, raw, { timestamp, signature, eventId: 'evt-1' })
    const bad = await hookPost(origin, cookie, hook.hook.id, raw, { timestamp, signature: 'aa', eventId: 'evt-2' })
    const old = await hookPost(origin, cookie, hook.hook.id, raw, {
      timestamp: String(Math.floor(Date.now() / 1000) - 600),
      signature,
      eventId: 'evt-3',
    })
    assert.equal(first.status, 202)
    assert.equal(second.body.duplicate, true)
    assert.equal(bad.status, 401)
    assert.equal(old.status, 401)
    const hookRows = await pluginGet(origin, cookie, `/session-foundations/api/deliveries?sessionId=${encodeURIComponent(sessionA)}`)
    assert.equal(hookRows.deliveries.filter((row: any) => row.kind === 'webhook').length, 1)
    evidence.webhookDuplicate = true

    const runAt = new Date(Date.now() + 800).toISOString()
    const timer = await plugin(origin, cookie, '/session-foundations/api/timers', {
      sessionId: sessionA,
      kind: 'one-shot',
      runAt,
      note: 'later',
    })
    assert.equal(timer.ok, true)
    const fired = await poll(async () => {
      const page = await pluginGet(origin, cookie, `/session-foundations/api/deliveries?sessionId=${encodeURIComponent(sessionA)}`)
      const rows = page.deliveries.filter((row: any) => row.kind === 'timer')
      return rows.length >= 1 ? rows : null
    })
    assert.equal(fired.length, 1)
    evidence.timer = fired[0].status
  } finally {
    await stop(child)
  }

  child = start(env, patch, port, join(work, 'dsh-2.log'))
  try {
    const cookie = await boot(child, join(work, 'dsh-2.log'), origin)
    const timers = await pluginGet(origin, cookie, `/session-foundations/api/deliveries?sessionId=${encodeURIComponent(sessionA)}`)
    assert.equal(timers.deliveries.filter((row: any) => row.kind === 'timer').length, 1)
    evidence.timerRestartDedup = true
    const cold = await plugin(origin, cookie, '/session-foundations/api/messages/send', {
      senderSessionId: sessionA,
      targetSessionId: sessionB,
      text: 'cold start',
      idempotencyKey: 'cold-1',
    })
    assert.equal(cold.ok, true)
    evidence.cold = cold.status
    const eventsB = await eventsOf(origin, cookie, sessionB)
    assert.ok(eventsB.some((event: any) => JSON.stringify(event!.data ?? {}).includes('cold start')))
  } finally {
    await stop(child)
  }

  const crashEnv = { ...env, SESSION_FOUNDATIONS_CRASH_BEFORE_FLUSH: '1' }
  child = start(crashEnv, patch, port, join(work, 'dsh-3.log'))
  try {
    const cookie = await boot(child, join(work, 'dsh-3.log'), origin)
    await plugin(origin, cookie, '/session-foundations/api/messages/send', {
      senderSessionId: sessionA,
      targetSessionId: sessionB,
      text: 'crash boundary',
      idempotencyKey: 'crash-1',
    }).catch(() => {})
    await delay(500)
  } finally {
    await stop(child)
  }
  child = start(env, patch, port, join(work, 'dsh-4.log'))
  try {
    const cookie = await boot(child, join(work, 'dsh-4.log'), origin)
    const recovered = await poll(async () => {
      const page = await pluginGet(origin, cookie, `/session-foundations/api/deliveries?sessionId=${encodeURIComponent(sessionB)}`)
      const row = page.deliveries.find((item: any) => item.kind === 'message' && item.sender_session_id === sessionA && item.hop === 1 && item.status !== 'intent' && item.status !== 'flushing')
      const crash = page.deliveries.filter((item: any) => item.status !== 'rejected')
      const db = new DatabaseSync(join(home, 'profiles', 'web', 'session-foundations', 'persona.sqlite'), { readOnly: true })
      const crashRow = db.prepare(`SELECT id, status, last_error, attempts, splice_seq FROM deliveries WHERE idempotency_key = 'crash-1'`).get()
      db.close()
      if (!crashRow) return null
      if (crashRow.status === 'intent' || crashRow.status === 'flushing' || crashRow.status === 'ambiguous') return null
      return { crashRow, sample: row, crash }
    })
    const settled = await poll(async () => {
      const eventsB = await eventsOf(origin, cookie, sessionB)
      const splices = eventsB.filter((event: any) => event!.type === 'agent/inbox/spliced' && JSON.stringify(event!.data).includes(recovered.crashRow.id))
      return splices.length > 0 ? splices : null
    })
    evidence.crash = { status: recovered.crashRow.status, error: recovered.crashRow.last_error, attempts: recovered.crashRow.attempts, splices: settled.length }
    assert.equal(settled.length, 1, JSON.stringify(evidence.crash))
    const again = await plugin(origin, cookie, '/session-foundations/api/messages/send', {
      senderSessionId: sessionA,
      targetSessionId: sessionB,
      text: 'crash boundary',
      idempotencyKey: 'crash-1',
    })
    assert.equal(again.deliveryId, recovered.crashRow.id)
    const eventsAfter = await eventsOf(origin, cookie, sessionB)
    const splicesAfter = eventsAfter.filter((event: any) => event!.type === 'agent/inbox/spliced' && JSON.stringify(event!.data).includes(recovered.crashRow.id))
    assert.equal(splicesAfter.length, 1)
  } finally {
    await stop(child)
  }
  console.log(`TRIGGER_EVIDENCE ${JSON.stringify(evidence)}`)
})

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} patch
 * @param {number} port
 * @param {string} logPath
 */
function start(env: any, patch: any, port: any, logPath: any) {
  const child = spawn(NODE, [DSH, '--profile', 'web', '--patch', patch, '--host', '127.0.0.1', '--port', String(port), '--no-open'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', chunk => writeFileSync(logPath, chunk, { flag: 'a' }))
  child.stderr.on('data', chunk => writeFileSync(logPath, chunk, { flag: 'a' }))
  return child
}

/**
 * @param {import('node:child_process').ChildProcess} child
 * @param {string} logPath
 * @param {string} origin
 */
async function boot(child: any, logPath: any, origin: any) {
  const token = await waitForToken(child, logPath)
  return exchange(origin, token)
}

/**
 * @param {import('node:child_process').ChildProcess} child
 * @param {string} logPath
 */
async function waitForToken(child: any, logPath: any) {
  const started = Date.now()
  while (Date.now() - started < 60000) {
    if (child.exitCode != null) throw new Error(`dsh exited ${child.exitCode}\n${existsSync(logPath) ? readFileSync(logPath, 'utf8').slice(-4000) : ''}`)
    const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
    const match = /token=([A-Za-z0-9._~+-]+)/.exec(log)
    if (match) return match[1]
    if (/Error|failed to/i.test(log) && /plugin|session-foundations|mock/.test(log)) throw new Error(log.slice(-4000))
    await delay(200)
  }
  throw new Error(`timed out\n${existsSync(logPath) ? readFileSync(logPath, 'utf8').slice(-4000) : ''}`)
}

/**
 * @param {string} origin
 * @param {string} token
 */
async function exchange(origin: any, token: any) {
  const response = await fetch(`${origin}/?token=${encodeURIComponent(token)}`, { redirect: 'manual' })
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
  const cookie = cookies.map(value => value.split(';', 1)[0]).join('; ')
  if (cookie === '') throw new Error(`token exchange HTTP ${response.status}`)
  return cookie
}

/**
 * @param {string} origin
 * @param {string} cookie
 * @param {string} work
 */
async function makeSession(origin: any, cookie: any, work: any) {
  const created = await rpc(origin, cookie, 'session/create', { request: { cwd: work } })
  const sessionId = created.result?.value?.sessionId
  assert.equal(typeof sessionId, 'string')
  await rpc(origin, cookie, 'session/selectModel', { request: { sessionId, provider: 'foundations-mock', model: 'mock-1' } })
  await plugin(origin, cookie, '/session-foundations/api/sessions/mark', { sessionId })
  return sessionId
}

/**
 * @param {string} origin
 * @param {string} cookie
 * @param {string} method
 * @param {Record<string, unknown>} args
 */
async function rpc(origin: any, cookie: any, method: any, args: any) {
  const response = await fetch(`${origin}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', cookie, origin },
    body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload: { args } }),
  })
  const body = await response.json()
  if (body?.result?.ok === false) throw new Error(`${method} failed ${JSON.stringify(body.result.error ?? body).slice(0, 800)}`)
  return { result: body?.result }
}

/**
 * @param {string} origin
 * @param {string} cookie
 * @param {string} path
 * @param {unknown} body
 */
async function plugin(origin: any, cookie: any, path: any, body: any) {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', cookie, origin },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let json
  try { json = JSON.parse(text) } catch { throw new Error(`${path} HTTP ${response.status} ${text.slice(0, 300)}`) }
  if (!response.ok) throw new Error(`${path} HTTP ${response.status} ${JSON.stringify(json).slice(0, 500)}`)
  return json
}

/**
 * @param {string} origin
 * @param {string} cookie
 * @param {string} path
 */
async function pluginGet(origin: any, cookie: any, path: any) {
  const response = await fetch(`${origin}${path}`, { headers: { accept: 'application/json', cookie, origin } })
  const json = await response.json()
  if (!response.ok) throw new Error(`${path} HTTP ${response.status} ${JSON.stringify(json).slice(0, 400)}`)
  return json
}

/**
 * @param {string} origin
 * @param {string} cookie
 * @param {string} sessionId
 * @param {string} text
 */
async function prompt(origin: any, cookie: any, sessionId: any, text: any) {
  await rpc(origin, cookie, 'session/prompt', {
    request: { requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text }] },
  })
}

/**
 * @param {string} origin
 * @param {string} cookie
 * @param {string} sessionId
 * @param {string} text
 */
async function promptAndWait(origin: any, cookie: any, sessionId: any, text: any) {
  await prompt(origin, cookie, sessionId, text)
  const waited = await rpc(origin, cookie, 'session/wait', { request: { sessionId, timeoutMs: 20000 } })
  if (waited.result?.value?.reason === 'timeout') throw new Error(`turn timed out ${text.slice(0, 80)}`)
}

/**
 * @param {string} origin
 * @param {string} cookie
 * @param {string} id
 * @param {Buffer} raw
 * @param {{ timestamp: string, signature: string, eventId: string }} headers
 */
async function hookPost(origin: any, cookie: any, id: any, raw: any, headers: any) {
  const response = await fetch(`${origin}/session-foundations/hooks/${id}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie,
      origin,
      'x-foundations-timestamp': headers.timestamp,
      'x-foundations-signature': headers.signature,
      'x-foundations-event-id': headers.eventId,
    },
    body: raw,
  })
  const text = await response.text()
  let body: Record<string, any> = {}
  try { body = JSON.parse(text) } catch { body = { raw: text.slice(0, 200) } }
  return { status: response.status, body }
}

/**
 * @param {string} origin
 * @param {string} cookie
 * @param {string} sessionId
 */
async function eventsOf(origin: any, cookie: any, sessionId: any) {
  const page = await rpc(origin, cookie, 'session/events', {
    request: { address: { kind: 'session', sessionId }, maxMessages: 800 },
  })
  const value = page.result?.value ?? page.result
  const records = value?.records ?? []
  return records.map((record: any) => record?.type === 'event' && record.event ? record.event : record)
}

/**
 * @param {() => Promise<unknown>} fn
 * @param {number} [ms]
 */
async function poll(fn: any, ms = 20000) {
  const started = Date.now()
  let last = null
  while (Date.now() - started < ms) {
    last = await fn()
    if (last) return last
    await delay(250)
  }
  throw new Error(`poll timeout ${JSON.stringify(last)?.slice(0, 500)}`)
}

/**
 * @param {import('node:child_process').ChildProcess} child
 */
async function stop(child: any) {
  if (child.exitCode != null) return
  child.kill('SIGTERM')
  const started = Date.now()
  while (child.exitCode == null && Date.now() - started < 8000) await delay(100)
  if (child.exitCode == null) child.kill('SIGKILL')
}
