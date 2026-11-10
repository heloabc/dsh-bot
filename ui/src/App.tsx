import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { api, readJsonStream } from './api'
import { browserCache, cachedEvent } from './cache'
import { foundations, foundationsError } from './foundations'
import { explain, type Copy } from './i18n'
import { useI18n } from './locale'
import { BriefingCard, WorkCard, WorkRefusal } from './WorkCard'
import { backgroundOpen, botSignal, budgetRefusalText, cardsToShow, chatStatus, composerLocked, dispatchTicketId, isBudgetRefusal, isTicketNotice, isWorkerSession, parseBriefing, readLiveBoard, workerTicketId, workPlaceholder, workPreview, type WorkTicket } from './work'
import { FilePreview } from './FilePreview'
import { NewSessionSheet, useSessionBasis } from './NewSession'
import { BotChatView, InboxLine } from './BotChatView'
import { TurnRail } from './TurnRail'
import { railMarks } from './turn-marks'
import { botExchange, inboxSummary, mainSegments } from './bot-chat'
import { parseBotMail } from './bot-message'
import { frameEvents, ingestFrame, isOpeningSnapshot, openingHistoryCut, previewOf, turnPieces } from './follow'
import { applyValue, FOLLOW_TAIL_MESSAGES } from '../../src/live-diff.ts'
import { loadSessionRange, loadSessionSnapshot } from './session-snapshot'
import { filterMentions, insertMention, mentionQuery, type MentionTarget } from './mentions'
import { MarkdownView } from './MarkdownView'
import { ActivityGroup } from './ProcessRow'
import { emptyThread, type HealthBody, type RetryAttempt, type Segment, type SessionItem, type TaskRecord, type ThreadState, type TurnFailure, type UsageBody } from './types'

function hashSession(): string {
  const parts = location.hash.replace(/^#\/?/, '').split('/')
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i]
    const value = parts[i + 1]
    if (key === 's' && value) return decodeURIComponent(value)
  }
  return ''
}

function loadMap(key: string): Record<string, string> {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || '{}') as unknown
    return value && typeof value === 'object' ? value as Record<string, string> : {}
  } catch {
    return {}
  }
}

function previewMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const next: Record<string, string> = {}
  for (const [id, text] of Object.entries(value)) {
    if (typeof text === 'string' && text !== '') next[id] = text
  }
  return next
}

function putPreviews(body: Record<string, unknown>) {
  void fetch('/dsh-bot/api/sessions/previews', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  })
}

function baseName(cwd?: string): string {
  const parts = (cwd ?? '').split('/').filter(Boolean)
  return parts.at(-1) ?? ''
}

function loadArchivedIds(): Promise<string[]> {
  return new Promise(resolve => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${proto}//${location.host}/api/remote.mux`)
    const timer = window.setTimeout(() => {
      socket.close()
      resolve([])
    }, 4000)
    const finish = (ids: string[]) => {
      window.clearTimeout(timer)
      socket.close()
      resolve(ids)
    }
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({
        type: 'open',
        streamId: 'archive',
        endpoint: 'workspace/follow',
        payload: { args: {} },
      }))
    })
    socket.addEventListener('message', (event) => {
      try {
        const frame = JSON.parse(String(event.data)) as { value?: { type?: string; value?: { archivedSessionIds?: unknown } } }
        const ids = frame.value?.type === 'baseline' ? frame.value.value?.archivedSessionIds : undefined
        if (!Array.isArray(ids)) return
        finish(ids.filter(id => typeof id === 'string'))
      } catch {
        // A non-JSON frame is not the archive baseline.
      }
    })
    socket.addEventListener('error', () => finish([]))
  })
}

function presetLabel(preset: string): string {
  if (preset === 'workspace-write') return 'Workspace Write'
  if (preset === 'read-only' || preset === 'readonly') return 'Read Only'
  if (preset === 'danger-full-access') return 'Full access'
  if (preset === 'auto') return 'Auto review'
  return preset
}

function clock(time: number | undefined, locale: string): string {
  if (!time) return ''
  const date = new Date(time)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en', { hour: '2-digit', minute: '2-digit' })
}

function hostText(code: string, fallback: string, t: Copy): string {
  return explain(code, fallback, t)
}

function HistoryLoading({ active, progress }: { active: boolean, progress: { loaded: number, total: number } | null }) {
  const { t } = useI18n()
  const [mounted, setMounted] = useState(active)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (active) {
      setMounted(true)
      return
    }
    setVisible(false)
  }, [active])
  useEffect(() => {
    if (!mounted || !active) return
    const frame = window.requestAnimationFrame(() => setVisible(true))
    return () => window.cancelAnimationFrame(frame)
  }, [mounted, active])
  useEffect(() => {
    if (active || !mounted) return
    const timer = window.setTimeout(() => setMounted(false), 280)
    return () => window.clearTimeout(timer)
  }, [active, mounted])
  if (!mounted) return null
  const known = progress != null && progress.total > 0
  const pct = known ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0
  return (
    <div className={visible ? 'chunk-loading visible' : 'chunk-loading'} role="status">
      <div className="chunk-loading-card">
        <p><span className="shimmer">{known ? t('load.messagesPct', { pct: String(pct) }) : t('load.messages')}</span></p>
        <div
          className="chunk-progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={known ? progress.total : 1}
          aria-valuenow={known ? progress.loaded : 0}
          aria-label={t('load.aria')}
        >
          <div className={known ? 'chunk-progress-fill' : 'chunk-progress-fill indeterminate'} style={known ? { width: `${pct}%` } : undefined} />
        </div>
      </div>
    </div>
  )
}

export function App() {
  const { t, locale, setLocale } = useI18n()
  const [sessionId, setSessionId] = useState(hashSession)
  const [items, setItems] = useState<SessionItem[]>([])
  const [sessionNote, setSessionNote] = useState('')
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [titles, setTitles] = useState(() => loadMap('dsh-bot.titles'))
  const [previews, setPreviews] = useState(() => loadMap('dsh-bot.previews'))
  const [thread, setThread] = useState<ThreadState>(emptyThread)
  const [historySession, setHistorySession] = useState('')
  const [chunkProgress, setChunkProgress] = useState<{ loaded: number, total: number } | null>(null)
  const [threadSession, setThreadSession] = useState(sessionId)
  if (threadSession !== sessionId) {
    setThreadSession(sessionId)
    setThread(emptyThread())
  }
  const [task, setTask] = useState<TaskRecord | null>(null)
  const [execution, setExecution] = useState({ ready: false, reason: 'loading' })
  const [health, setHealth] = useState<HealthBody | null>(null)
  const [usage, setUsage] = useState<UsageBody | null>(null)
  const [statusOpen, setStatusOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [cursor, setCursor] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionClosed, setMentionClosed] = useState('')
  const [reason, setReason] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [filePreview, setFilePreview] = useState<{ path: string; line?: number } | null>(null)
  const [archived, setArchived] = useState<ReadonlySet<string>>(() => new Set())
  const [blanksOpen, setBlanksOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [botChat, setBotChat] = useState(false)
  const [setupNote, setSetupNote] = useState('')
  const [basisRevision, setBasisRevision] = useState(0)
  const [bots, setBots] = useState<ReadonlySet<string>>(() => new Set())
  const [botNames, setBotNames] = useState<Record<string, string>>({})
  const [workCards, setWorkCards] = useState<Record<string, WorkTicket[]>>({})
  const [workReady, setWorkReady] = useState(false)
  const [remoteStatus, setRemoteStatus] = useState<Record<string, string[]>>({})
  const [workNow, setWorkNow] = useState(() => Date.now())
  const [workerOwner, setWorkerOwner] = useState('')
  const basis = useSessionBasis(sessionId, basisRevision)
  const scrollRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const localSeq = useRef(0)
  const previewQueue = useRef(new Map<string, string>())
  const previewTimer = useRef(0)
  const previewKnown = useRef(new Map<string, string>())
  const previewSeeded = useRef(false)
  const sessionRef = useRef(sessionId)
  const followSwitch = useRef<(id: string) => void>(() => {})
  const historyPush = useRef<(events: unknown[]) => void>(() => {})
  const historyCut = useRef<(id: string) => Promise<number | null>>(async () => null)
  const chunkCache = useRef(browserCache())
  sessionRef.current = sessionId

  function sessionName(item: { sessionId: string, cwd?: string, title?: string | null }): string {
    return botNames[item.sessionId] || titles[item.sessionId] || item.title || baseName(item.cwd) || t('session.unnamed')
  }
  function botLabel(id: string): string {
    const item = items.find(entry => entry.sessionId === id)
    if (item) return sessionName(item)
    return botNames[id] || titles[id] || ''
  }
  const exchange = botExchange(thread.segments)
  const historyLoading = sessionId !== '' && historySession !== sessionId
  const chunkBusy = chunkProgress != null && chunkProgress.total > 0 && chunkProgress.loaded < chunkProgress.total
  const conversation = useMemo(() => mainSegments(thread.segments), [thread.segments])
  const marks = useMemo(() => railMarks(conversation), [conversation])
  const title = sessionId ? sessionName({ sessionId, cwd: items.find(item => item.sessionId === sessionId)?.cwd, title: thread.title || null }) : t('app.title')
  const nativeHref = sessionId ? `/#/s/${encodeURIComponent(sessionId)}` : '/'

  function selectSession(id: string) {
    setBotChat(false)
    setSessionId(id)
    setMenuOpen(false)
    setFilePreview(null)
    setTask(null)
    setReason('')
    setSetupNote('')
    const next = id ? `#/s/${encodeURIComponent(id)}` : '#/'
    if (location.hash !== next) history.replaceState(null, '', next)
  }

  function openWorkerSession(id: string) {
    if (!id || id === sessionId) return
    const owner = sessionId
    setBotChat(false)
    setSessionId(id)
    setMenuOpen(false)
    setFilePreview(null)
    setTask(null)
    setReason('')
    setSetupNote('')
    const next = `#/s/${encodeURIComponent(id)}`
    if (location.hash !== next) history.pushState({ kind: 'worker', owner }, '', next)
  }

  function leaveWorker() {
    setBotChat(false)
    setMenuOpen(false)
    setFilePreview(null)
    const state = history.state as { kind?: string } | null
    if (state?.kind === 'worker') {
      history.back()
      return
    }
    if (workerOwner) selectSession(workerOwner)
  }

  useEffect(() => {
    let stop = false
    void loadArchivedIds().then(ids => {
      if (!stop) setArchived(new Set(ids))
    })
    return () => { stop = true }
  }, [])

  function applyLiveDocument(body: Record<string, unknown>) {
    const board = readLiveBoard(body)
    if (board) {
      setRemoteStatus(board.signals)
      setWorkCards(board.cards)
      setWorkReady(true)
    }
    const desk = body.desk
    if (!desk || typeof desk !== 'object' || Array.isArray(desk)) return
    const row = desk as Record<string, unknown>
    const sessions = row.sessions
    if (sessions && typeof sessions === 'object' && !Array.isArray(sessions)) {
      const sessionBody = sessions as Record<string, unknown>
      const value = sessionBody.result as { ok?: boolean, value?: { items?: SessionItem[] }, error?: { message?: string } } | undefined
      if (value?.ok !== true) {
        setSessionNote(value?.error?.message || String(sessionBody.error || t('session.listUnavailable')))
      } else {
        setSessionNote('')
        setItems(value.value?.items ?? [])
        takePreviews(sessionBody.previews)
        if (!previewSeeded.current) {
          previewSeeded.current = true
          const disk = previewMap(sessionBody.previews)
          const missing: Record<string, string> = {}
          for (const [id, text] of Object.entries(loadMap('dsh-bot.previews'))) {
            if (!disk[id] && text) missing[id] = text
          }
          if (Object.keys(missing).length > 0) putPreviews({ previews: missing })
        }
      }
    }
    const roster = row.bots
    if (roster && typeof roster === 'object' && !Array.isArray(roster) && (roster as { ok?: unknown }).ok === true) {
      const botsBody = roster as { bots?: unknown, sessionIds?: unknown }
      const cards = Array.isArray(botsBody.bots) ? botsBody.bots : []
      const ids = cards.flatMap(card => {
        if (!card || typeof card !== 'object') return []
        const id = (card as { sessionId?: unknown }).sessionId
        return typeof id === 'string' ? [id] : []
      })
      const names: Record<string, string> = {}
      for (const card of cards) {
        if (!card || typeof card !== 'object') continue
        const id = (card as { sessionId?: unknown }).sessionId
        const label = (card as { name?: unknown }).name
        if (typeof id === 'string' && typeof label === 'string' && label !== '') names[id] = label
      }
      if (ids.length === 0 && Array.isArray(botsBody.sessionIds)) {
        for (const id of botsBody.sessionIds) if (typeof id === 'string') ids.push(id)
      }
      setBots(new Set(ids))
      setBotNames(names)
    }
    const health = row.health
    if (health && typeof health === 'object' && !Array.isArray(health)) {
      const healthBody = health as HealthBody
      setHealth(healthBody)
      if (healthBody.execution) {
        setExecution({
          ready: healthBody.execution.ready === true,
          reason: healthBody.execution.reason || (healthBody.execution.ready === true ? '' : 'catalog_unreadable'),
        })
      }
    }
    const usage = row.usage
    if (usage && typeof usage === 'object' && !Array.isArray(usage)) setUsage(usage as UsageBody)
  }

  useEffect(() => {
    let stop = false
    void (async () => {
      try {
        const listed = await api('/sessions')
        if (stop) return
        const result = listed.body.result as { ok?: boolean, value?: { items?: SessionItem[] }, error?: { message?: string } } | undefined
        if (result?.ok === true) {
          setSessionNote('')
          setItems(result.value?.items ?? [])
          takePreviews(listed.body.previews)
        } else if (listed.status !== 200) {
          setSessionNote(result?.error?.message || t('session.listUnavailable'))
        }
      } catch { /* the live stream still fills the list */ }
      try {
        const roster = await api('/sessions/bots')
        if (stop || roster.body.ok !== true) return
        const cards = Array.isArray(roster.body.bots) ? roster.body.bots : []
        const ids = cards.flatMap(card => {
          if (!card || typeof card !== 'object') return []
          const id = (card as { sessionId?: unknown }).sessionId
          return typeof id === 'string' ? [id] : []
        })
        const names: Record<string, string> = {}
        for (const card of cards) {
          if (!card || typeof card !== 'object') continue
          const id = (card as { sessionId?: unknown }).sessionId
          const label = (card as { name?: unknown }).name
          if (typeof id === 'string' && typeof label === 'string' && label !== '') names[id] = label
        }
        if (ids.length === 0 && Array.isArray(roster.body.sessionIds)) {
          for (const id of roster.body.sessionIds) if (typeof id === 'string') ids.push(id)
        }
        setBots(new Set(ids))
        setBotNames(names)
      } catch { /* the live desk still carries the roster */ }
    })()
    return () => { stop = true }
  }, [])

  useEffect(() => {
    let stop = false
    let source: EventSource | null = null
    let timer = 0
    let deskDoc: unknown
    let workDoc: unknown
    const take = (event: Event) => {
      let row: Record<string, unknown>
      try { row = JSON.parse(String((event as MessageEvent).data)) as Record<string, unknown> } catch { return null }
      return row.ok === true ? row : null
    }
    const connect = () => {
      source?.close()
      deskDoc = undefined
      workDoc = undefined
      const next = new EventSource('/dsh-bot/api/live')
      source = next
      next.addEventListener('snapshot', (event) => {
        if (stop || source !== next) return
        const row = take(event)
        if (!row) return
        if (row.desk !== undefined) deskDoc = row.desk
        if (row.work !== undefined) workDoc = row.work
        applyLiveDocument(row)
      })
      next.addEventListener('delta', (event) => {
        if (stop || source !== next) return
        const row = take(event)
        if (!row) return
        const merged: Record<string, unknown> = { ok: true }
        if (row.desk !== undefined && deskDoc !== undefined) {
          deskDoc = applyValue(deskDoc, row.desk)
          merged.desk = deskDoc
        }
        if (row.work !== undefined && workDoc !== undefined) {
          workDoc = applyValue(workDoc, row.work)
          merged.work = workDoc
        }
        if (merged.desk !== undefined || merged.work !== undefined) applyLiveDocument(merged)
      })
      next.addEventListener('error', () => {
        if (stop || source !== next) return
        next.close()
        if (source === next) source = null
        timer = window.setTimeout(connect, 2000)
      })
    }
    connect()
    return () => {
      stop = true
      window.clearTimeout(timer)
      source?.close()
    }
  }, [])

  useEffect(() => {
    const onHash = () => {
      setBotChat(false)
      setMenuOpen(false)
      setFilePreview(null)
      setTask(null)
      setReason('')
      setSetupNote('')
      setSessionId(hashSession())
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    let stopped = false
    let socket: WebSocket | null = null
    let retries = 0
    let reconnectTimer = 0
    let activeStream = ''
    let streamSeq = 0
    let seen = new Set<number>()
    let queue: unknown[] = []
    let raf = 0
    let cutSession = ''
    let cutSettled = false
    let cutValue: number | null = null
    let cutResolve: ((value: number | null) => void) | null = null
    const armCut = (id: string) => {
      if (cutResolve) {
        const resolve = cutResolve
        cutResolve = null
        resolve(null)
      }
      cutSession = id
      cutSettled = false
      cutValue = null
    }
    const settleCut = (id: string, value: number | null) => {
      if (id !== cutSession || cutSettled) return
      cutSettled = true
      cutValue = value
      if (!cutResolve) return
      const resolve = cutResolve
      cutResolve = null
      resolve(value)
    }
    const takeCut = (id: string) => {
      if (id === cutSession && cutSettled) return Promise.resolve(cutValue)
      return new Promise<number | null>(resolve => {
        if (id === cutSession && cutSettled) {
          resolve(cutValue)
          return
        }
        if (cutResolve) cutResolve(null)
        cutResolve = resolve
        cutSession = id
      })
    }
    const flush = () => {
      raf = 0
      if (stopped) return
      const frames = queue
      queue = []
      const session = sessionRef.current
      const opened = frames.some(frame => isOpeningSnapshot(frame))
      setThread(prev => frames.reduce<ThreadState>((current, frame) => ingestFrame(current, frame, seen), prev))
      if (opened && session) {
        setHistorySession(session)
        for (const frame of frames) {
          const cut = openingHistoryCut(frame)
          if (cut == null) continue
          settleCut(session, cut)
          break
        }
      }
      if (session) {
        const rows = frames.flatMap(frame => frameEvents(frame).flatMap(event => {
          const row = cachedEvent(session, event)
          return row ? [row] : []
        }))
        if (rows.length > 0) void chunkCache.current.putEvents(session, rows).catch(() => {})
      }
    }
    const dropPending = () => {
      queue = []
      if (raf) window.cancelAnimationFrame(raf)
      raf = 0
      seen = new Set()
    }
    const send = (body: unknown) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return false
      socket.send(JSON.stringify(body))
      return true
    }
    const sendOpen = (id: string) => {
      if (!id) return
      streamSeq += 1
      const streamId = `follow-${streamSeq}`
      const opened = send({
        type: 'open',
        streamId,
        endpoint: 'session/follow',
        payload: { args: { request: { address: { kind: 'session', sessionId: id }, maxMessages: FOLLOW_TAIL_MESSAGES, assistantStream: true } } },
      })
      activeStream = opened ? streamId : ''
    }
    const subscribe = (id: string) => {
      armCut(id)
      dropPending()
      if (activeStream) send({ type: 'cancel', streamId: activeStream })
      activeStream = ''
      sendOpen(id)
    }
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const next = new WebSocket(`${proto}//${location.host}/api/remote.mux`)
      socket = next
      next.addEventListener('open', () => {
        if (stopped || socket !== next) return
        retries = 0
        activeStream = ''
        sendOpen(sessionRef.current)
      })
      next.addEventListener('message', (event) => {
        let frame: { type?: unknown, streamId?: unknown }
        try { frame = JSON.parse(String(event.data)) as { type?: unknown, streamId?: unknown } } catch { return }
        if (frame.streamId !== activeStream || frame.type !== 'item') return
        queue.push(frame)
        if (!raf) raf = window.requestAnimationFrame(flush)
      })
      next.addEventListener('close', () => {
        if (stopped || socket !== next) return
        activeStream = ''
        retries += 1
        if (retries <= 3) reconnectTimer = window.setTimeout(connect, 1000)
        else settleCut(sessionRef.current, null)
      })
    }
    const pushHistory = (events: unknown[]) => {
      if (stopped || events.length === 0) return
      queue.push(...events)
      if (!raf) raf = window.requestAnimationFrame(flush)
    }
    followSwitch.current = subscribe
    historyPush.current = pushHistory
    historyCut.current = takeCut
    connect()
    return () => {
      stopped = true
      followSwitch.current = () => {}
      historyPush.current = () => {}
      historyCut.current = async () => null
      if (cutResolve) cutResolve(null)
      window.clearTimeout(reconnectTimer)
      if (raf) window.cancelAnimationFrame(raf)
      socket?.close()
    }
  }, [])

  useEffect(() => {
    if (sessionId) setThread(emptyThread())
    setChunkProgress(null)
    followSwitch.current(sessionId)
    if (!sessionId) return
    const cutPromise = historyCut.current(sessionId)
    let stop = false
    const paint = (events: unknown[]) => {
      if (stop || sessionRef.current !== sessionId || events.length === 0) return
      historyPush.current(events)
      setHistorySession(sessionId)
    }
    void (async () => {
      const cache = chunkCache.current
      try { await cache.open() } catch { return }
      if (stop || sessionRef.current !== sessionId) return
      try {
        const cached = await cache.readEvents(sessionId)
        paint(cached.map(row => row.event))
      } catch { /* the follow socket still fills the thread */ }
      const read = async (path: string, onBytes?: (received: number, total: number | null) => void) => {
        if (!onBytes) return api(path)
        const response = await fetch('/dsh-bot/api' + path, { headers: { accept: 'application/json' } })
        let parsed: unknown = null
        try { parsed = await readJsonStream(response, onBytes) } catch { parsed = null }
        const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
        return { status: response.status, body }
      }
      try {
        const loaded = await loadSessionSnapshot(sessionId, cache, read, progress => {
          if (stop || sessionRef.current !== sessionId) return
          setChunkProgress(progress.loaded < progress.total ? progress : null)
        }, 0, undefined, FOLLOW_TAIL_MESSAGES)
        if (stop || sessionRef.current !== sessionId) return
        setChunkProgress(null)
        if (loaded.events?.length) paint(loaded.events)
        const followSeq = await cutPromise
        if (stop || sessionRef.current !== sessionId) return
        const covered = loaded.beforeSeq
        const gap = typeof followSeq === 'number' && covered != null && followSeq > covered
          ? await loadSessionRange(sessionId, covered, followSeq, read)
          : followSeq == null && covered != null && covered > 0
            ? await loadSessionRange(sessionId, covered, undefined, read)
            : null
        if (gap?.length) paint(gap)
      } catch { /* a cache miss leaves the live tail on the follow socket */ }
    })()
    return () => { stop = true }
  }, [sessionId])

  useEffect(() => {
    if (!sessionId || threadSession !== sessionId || !thread.title || botNames[sessionId]) return
    setTitles(current => {
      if (current[sessionId] === thread.title) return current
      const next = { ...current, [sessionId]: thread.title }
      sessionStorage.setItem('dsh-bot.titles', JSON.stringify(next))
      return next
    })
  }, [sessionId, threadSession, thread.title, botNames])

  const isBotSession = Boolean(sessionId) && bots.has(sessionId)
  const works = isBotSession && workReady ? (workCards[sessionId] ?? []) : []
  const loadedWorkSession = isBotSession && workReady ? sessionId : ''
  useEffect(() => {
    if (!sessionId || !isWorkerSession(sessionId)) {
      setWorkerOwner('')
      return
    }
    let stop = false
    const ticketId = workerTicketId(sessionId)
    void foundations(`/dsh-bot/api/work/ticket?id=${encodeURIComponent(ticketId)}`).then(result => {
      if (stop || result.body.ok !== true || !result.body.ticket || typeof result.body.ticket !== 'object') return
      const owner = (result.body.ticket as { owner_session_id?: unknown }).owner_session_id
      if (typeof owner === 'string') setWorkerOwner(owner)
    })
    return () => { stop = true }
  }, [sessionId])

  const workTicking = works.some(ticket => ticket.status === 'started')
  useEffect(() => {
    if (!workTicking) return
    const timer = window.setInterval(() => setWorkNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [workTicking])

  function takePreviews(value: unknown) {
    const incoming = previewMap(value)
    if (Object.keys(incoming).length === 0) return
    setPreviews(current => {
      let changed = false
      const next = { ...current }
      for (const [id, text] of Object.entries(incoming)) {
        if (next[id]) continue
        next[id] = text
        changed = true
      }
      if (!changed) return current
      sessionStorage.setItem('dsh-bot.previews', JSON.stringify(next))
      return next
    })
  }

  function flushPreviews() {
    window.clearTimeout(previewTimer.current)
    previewTimer.current = 0
    const queued = [...previewQueue.current]
    previewQueue.current.clear()
    if (queued.length === 0) return
    if (queued.length === 1) {
      const [id, preview] = queued[0] ?? []
      if (id && preview) putPreviews({ sessionId: id, preview })
      return
    }
    putPreviews({ previews: Object.fromEntries(queued) })
  }

  useEffect(() => () => { flushPreviews() }, [])

  useEffect(() => {
    if (!sessionId || threadSession !== sessionId) return
    const preview = previewOf(thread.segments)
    if (!preview || previewKnown.current.get(sessionId) === preview) return
    previewKnown.current.set(sessionId, preview)
    setPreviews(current => {
      if (current[sessionId] === preview) return current
      const next = { ...current, [sessionId]: preview }
      sessionStorage.setItem('dsh-bot.previews', JSON.stringify(next))
      return next
    })
    previewQueue.current.set(sessionId, preview)
    window.clearTimeout(previewTimer.current)
    previewTimer.current = window.setTimeout(flushPreviews, 400)
  }, [sessionId, threadSession, thread.segments])

  useEffect(() => {
    if (!menuOpen) return
    const close = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  useEffect(() => {
    setBotChat(false)
  }, [sessionId])

  const workKey = works.map(ticket => `${ticket.id}:${ticket.status}:${ticket.revision}`).join('\n')
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [thread.segments, thread.drafting, thread.activity, sessionId, botChat, workKey])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return items.filter(item => {
      if (isWorkerSession(item.sessionId) || archived.has(item.sessionId)) return false
      if (!needle) return true
      const name = sessionName(item)
      return [name, item.cwd ?? '', previews[item.sessionId] ?? ''].join(' ').toLowerCase().includes(needle)
    })
  }, [items, query, titles, previews, archived, botNames])
  const conversations = visible.filter(item => !item.blank)
  const blanks = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return items.filter(item => {
      if (item.blank !== true || isWorkerSession(item.sessionId)) return false
      if (!needle) return true
      const name = sessionName(item)
      return [name, item.cwd ?? ''].join(' ').toLowerCase().includes(needle)
    })
  }, [items, query, titles, botNames])
  const showBlanks = blanksOpen || query.trim() !== ''
  const mentionTargets = useMemo(() => {
    if (!sessionId || !bots.has(sessionId)) return []
    return items.flatMap(item => {
      if (!bots.has(item.sessionId) || item.sessionId === sessionId || archived.has(item.sessionId) || isWorkerSession(item.sessionId)) return []
      return [{ sessionId: item.sessionId, label: sessionName(item) }]
    })
  }, [items, bots, sessionId, archived, botNames, titles])
  const mention = sessionId && bots.has(sessionId) ? mentionQuery(draft, cursor) : null
  const mentionKey = mention ? `${mention.start}:${mention.query}` : ''
  const mentionChoices = mention ? filterMentions(mentionTargets, mention.query) : []
  const mentionOpen = mention != null && mentionClosed !== mentionKey
  const mentionActive = Math.min(mentionIndex, Math.max(mentionChoices.length - 1, 0))

  useEffect(() => { setMentionIndex(0) }, [mentionKey])

  function rememberArchived(ids: unknown, removed: string[]) {
    const next = new Set(archived)
    for (const id of removed) next.add(id)
    if (Array.isArray(ids)) {
      for (const id of ids) if (typeof id === 'string') next.add(id)
    }
    setArchived(next)
    if (removed.includes(sessionId)) selectSession('')
  }

  async function removeBlank(id: string) {
    const result = await api(`/sessions/${encodeURIComponent(id)}/archive`, { method: 'POST' })
    if (result.status !== 200) {
      const upstream = result.body.upstream as { message?: string } | undefined
      setSessionNote(upstream?.message || (result.body.error === 'not_blank' ? t('session.notBlankArchive') : t('session.archiveFailed')))
      return
    }
    setSessionNote('')
    rememberArchived(result.body.archivedSessionIds, [id])
  }

  async function removeBlanks() {
    if (blanks.length === 0) return
    if (!window.confirm(t('session.archiveConfirm', { count: String(blanks.length) }))) return
    const removed: string[] = []
    let archivedIds: unknown = []
    for (const item of blanks) {
      const result = await api(`/sessions/${encodeURIComponent(item.sessionId)}/archive`, { method: 'POST' })
      if (result.status !== 200) {
        const upstream = result.body.upstream as { message?: string } | undefined
        setSessionNote(upstream?.message || t('session.archiveSomeFailed'))
        break
      }
      removed.push(item.sessionId)
      archivedIds = result.body.archivedSessionIds
    }
    if (removed.length > 0) rememberArchived(archivedIds, removed)
  }

  async function purgeBlank(id: string) {
    const item = items.find(entry => entry.sessionId === id)
    const name = titles[id] || baseName(item?.cwd) || t('session.blankName')
    if (!window.confirm(t('session.purgeOneConfirm', { name }))) return
    const result = await api(`/sessions/${encodeURIComponent(id)}/purge`, { method: 'POST' })
    if (result.status !== 200) {
      setSessionNote(result.body.error === 'not_blank' ? t('session.purgeNotBlank') : t('session.purgeFailed'))
      return
    }
    setItems(current => current.filter(entry => entry.sessionId !== id))
    setArchived(current => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
    if (sessionId === id) selectSession('')
  }

  async function purgeBlanks() {
    const targets = blanks.filter(item => item.blank === true)
    if (targets.length === 0) return
    if (!window.confirm(t('session.purgeAllConfirm', { count: String(targets.length) }))) return
    const removed: string[] = []
    for (const item of targets) {
      const result = await api(`/sessions/${encodeURIComponent(item.sessionId)}/purge`, { method: 'POST' })
      if (result.status !== 200) {
        setSessionNote(t('session.purgeSomeFailed'))
        break
      }
      removed.push(item.sessionId)
    }
    if (removed.length === 0) return
    const gone = new Set(removed)
    setItems(current => current.filter(entry => !gone.has(entry.sessionId)))
    setArchived(current => {
      const next = new Set(current)
      for (const id of removed) next.delete(id)
      return next
    })
    if (gone.has(sessionId)) selectSession('')
  }

  async function finishCreate(id: string, note: string, name: string) {
    setSetupOpen(false)
    if (name !== '') {
      setBotNames(current => ({ ...current, [id]: name }))
      setBots(current => new Set([...current, id]))
      setTitles(current => {
        const next = { ...current, [id]: name }
        sessionStorage.setItem('dsh-bot.titles', JSON.stringify(next))
        return next
      })
    }
    const listed = await api('/sessions')
    const value = listed.body.result as { value?: { items?: SessionItem[] } } | undefined
    setItems(value?.value?.items ?? [])
    selectSession(id)
    setSetupNote(note)
    setBasisRevision(current => current + 1)
  }

  function placeDraft(text: string, nextCursor: number) {
    setDraft(text)
    setCursor(nextCursor)
    window.requestAnimationFrame(() => {
      const node = draftRef.current
      if (!node) return
      node.focus()
      node.setSelectionRange(nextCursor, nextCursor)
    })
  }

  function chooseMention(target: MentionTarget) {
    if (!mention) return
    const next = insertMention(draft, cursor, mention.start, target.label, target.sessionId)
    placeDraft(next.text, next.cursor)
  }

  function insertSlash(command = '/') {
    setMenuOpen(false)
    setDraft(current => {
      const trimmed = current.replace(/\s+$/, '')
      if (trimmed === '') return command === '/' ? '/' : `${command} `
      return `${trimmed} ${command === '/' ? '/' : `${command} `}`
    })
    window.requestAnimationFrame(() => draftRef.current?.focus())
  }

  async function submit(text: string) {
    const turnLive = task?.status === 'accepted' && thread.drafting
    const tickets = loadedWorkSession === sessionId ? works : []
    if (!sessionId || !text || !execution.ready || composerLocked(turnLive, tickets, bots.has(sessionId))) return
    const wasLive = thread.drafting
    setDraft('')
    setReason('')
    localSeq.current += 1
    const seq = Number.MAX_SAFE_INTEGER - localSeq.current
    setThread(prev => ({
      ...prev,
      drafting: true,
      segments: [...prev.segments, { kind: 'user', id: `optimistic:${seq}`, text, time: Date.now(), seq, optimistic: true }],
    }))
    const result = await api('/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ sessionId, text }),
    })
    const nextTask = result.body.task as TaskRecord | undefined
    setTask(nextTask ?? null)
    if (result.status !== 202) {
      setThread(prev => ({
        ...prev,
        drafting: wasLive ? prev.drafting : false,
        segments: prev.segments.filter(item => !(item.kind === 'user' && item.optimistic && item.text === text)),
      }))
      const blocked = result.body.execution as { reason?: string } | undefined
      setReason(blocked?.reason || hostText(String(result.body.error || ''), t('composer.notSent'), t))
    }
  }

  async function send() {
    const text = draft.trim()
    if (!text) return
    await submit(text)
  }

  async function supplyWork(ticketId: string, text: string) {
    const result = await foundations('/dsh-bot/api/work/supply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, ticketId, text }),
    })
    if (result.status !== 200 || result.body.ok === false) return foundationsError(result.body, t('composer.supplyFailed'))
    return ''
  }

  async function cancel() {
    if (!task || task.status !== 'accepted') return
    const result = await api(`/tasks/${task.id}/cancel?sessionId=${encodeURIComponent(task.sessionId ?? '')}`, { method: 'POST' })
    const nextTask = (result.body.task as TaskRecord | undefined) ?? task
    setTask(nextTask)
    if (nextTask.status === 'cancelled') setThread(prev => ({ ...prev, drafting: false }))
  }

  const turnLive = task?.status === 'accepted' && thread.drafting
  const workTickets = loadedWorkSession === sessionId ? works : []
  const locked = composerLocked(turnLive, workTickets, isBotSession)
  const canSend = Boolean(sessionId) && execution.ready && draft.trim() !== '' && !locked

  function signalFor(item: { sessionId: string, running?: boolean }): 'run' | 'wait' | null {
    if (!bots.has(item.sessionId)) return null
    const live = item.running === true || (item.sessionId === sessionId && (turnLive || thread.drafting))
    const tickets = item.sessionId === sessionId && loadedWorkSession === sessionId
      ? works
      : (remoteStatus[item.sessionId] ?? []).map(status => ({ status }))
    return botSignal(tickets, live)
  }

  return (
    <div className={sessionId ? 'shell in-chat' : 'shell'}>
      <aside className="side">
        <div className="side-top">
          <strong className="brand">{t('app.title')}</strong>
          <span className="side-actions">
            <button type="button" className="icon-btn" aria-label={t('session.search')} onClick={() => setSearching(value => !value)}>
              <SearchIcon />
            </button>
            <button type="button" className="icon-btn" aria-label={t('new.title')} onClick={() => setSetupOpen(true)}>
              <PlusIcon />
            </button>
          </span>
        </div>
        {searching ? <input className="filter" value={query} placeholder={t('session.searchPlaceholder')} onChange={event => setQuery(event.target.value)} /> : null}
        {sessionNote ? <p className="note">{sessionNote}</p> : null}
        {setupNote ? <p className="note ok">{setupNote}</p> : null}
        <ul className="sessions">
          {conversations.length === 0 && blanks.length === 0 ? <li className="empty">{items.length ? t('session.noMatch') : t('session.none')}</li> : null}
          {conversations.map(item => {
            const name = sessionName(item)
            return (
              <li key={item.sessionId}>
                <button
                  type="button"
                  className={item.sessionId === sessionId ? 'session selected' : 'session'}
                  title={item.cwd || item.sessionId}
                  onClick={() => selectSession(item.sessionId)}
                >
                  <span className={bots.has(item.sessionId) ? 'mark bot-mark' : 'mark'}>
                    {bots.has(item.sessionId) ? 'BOT' : Array.from(name)[0]}
                    <BotDot signal={signalFor(item)} />
                  </span>
                  <span className="copy">
                    <span className="name">{name}</span>
                    <span className="preview">{(item.sessionId === sessionId ? workPreview(works, workNow, t) : '') || previews[item.sessionId] || (item.running ? t('session.running') : '')}</span>
                  </span>
                </button>
              </li>
            )
          })}
          {blanks.length > 0 ? (
            <li className="blank-head">
              <button type="button" aria-expanded={showBlanks} onClick={() => setBlanksOpen(value => !value)}>
                {showBlanks ? t('session.hide') : t('session.show')} {t('session.blankCount', { count: String(blanks.length) })}
              </button>
              <button type="button" onClick={() => { void removeBlanks() }}>{t('session.archiveAll')}</button>
              <button type="button" onClick={() => { void purgeBlanks() }}>{t('session.purgeAll')}</button>
            </li>
          ) : null}
          {showBlanks ? blanks.map(item => {
            const name = sessionName(item)
            return (
              <li key={item.sessionId} className="session-row">
                <button
                  type="button"
                  className={item.sessionId === sessionId ? 'session selected' : 'session'}
                  title={item.cwd || item.sessionId}
                  onClick={() => selectSession(item.sessionId)}
                >
                  <span className={bots.has(item.sessionId) ? 'mark bot-mark' : 'mark'}>{bots.has(item.sessionId) ? 'BOT' : Array.from(name)[0]}</span>
                  <span className="copy">
                    <span className="name">{name}</span>
                    <span className="preview">{archived.has(item.sessionId) ? t('session.archived') : t('session.blank')}</span>
                  </span>
                </button>
                {archived.has(item.sessionId) ? null : (
                  <button type="button" className="session-delete" aria-label={t('session.archiveLabel', { name })} onClick={() => { void removeBlank(item.sessionId) }}>
                    {t('session.archive')}
                  </button>
                )}
                <button type="button" className="session-delete purge" aria-label={t('session.purgeLabel', { name })} onClick={() => { void purgeBlank(item.sessionId) }}>
                  {t('session.purge')}
                </button>
              </li>
            )
          }) : null}
        </ul>
        {statusOpen ? <Status health={health} usage={usage} execution={execution} model={thread.model} /> : null}
        <div className="me-row">
          <button type="button" className="me" onClick={() => setStatusOpen(value => !value)}>
            <span className="mark me-mark">{t('local.mark')}</span>
            <span>{health?.primary?.reachable === false ? t('local.down') : t('local.here')}</span>
          </button>
          <button type="button" className="lang-switch" onClick={() => setLocale(locale === 'en' ? 'zh' : 'en')}>{t('lang.switch')}</button>
        </div>
      </aside>
      <section className="chat">
        <header className="chat-head">
          {botChat ? (
            <button type="button" className="bot-chat-back" onClick={() => setBotChat(false)}>{t('nav.back')}</button>
          ) : isWorkerSession(sessionId) ? (
            <button type="button" className="back" onClick={leaveWorker}>{t('nav.back')}</button>
          ) : (
            <button type="button" className="back" onClick={() => setSessionId('')}>{t('nav.sessions')}</button>
          )}
          {sessionId && bots.has(sessionId) ? (
            <span className="bot-badge">
              BOT
              <BotDot signal={signalFor({ sessionId, running: items.find(item => item.sessionId === sessionId)?.running })} />
            </span>
          ) : null}
          <h1>{botChat ? t('nav.botMessages') : title}</h1>
          {!botChat && workPreview(works, workNow, t) ? <span className="work-chip">{workPreview(works, workNow, t)}</span> : null}
          <a href={nativeHref}>{t('nav.official')}</a>
        </header>
        {isWorkerSession(sessionId) && !botChat ? (
          <nav className="work-crumb" aria-label={t('nav.where')}>
            <button type="button" onClick={leaveWorker}>{(workerOwner && botLabel(workerOwner)) || t('nav.mainSession')}</button>
            <span aria-hidden="true">/</span>
            <span>{t('nav.worker')}</span>
          </nav>
        ) : null}
        {basis && !botChat ? <p className="basis">{basis}</p> : null}
        <div className="chat-body">
        <HistoryLoading active={historyLoading || chunkBusy} progress={chunkProgress} />
        <div className="scroll" ref={scrollRef} aria-busy={historyLoading || chunkBusy || undefined}>
          <div className="column">
            {!sessionId ? <p className="empty-thread">{t('nav.pick')}</p> : null}
            {sessionId && !historyLoading && !chunkBusy && !botChat && conversation.length === 0 && works.length === 0 ? <p className="empty-thread">{t('nav.empty')}</p> : null}
            {historyLoading ? null : botChat ? (
              <BotChatView
                items={exchange}
                botLabel={botLabel}
                onOpenFile={(path, line) => setFilePreview({ path, line })}
              />
            ) : (
              <Transcript
                segments={conversation}
                completed={thread.completed}
                failures={thread.failures}
                retries={thread.retries}
                turnEnds={thread.turnEnds}
                tickets={works}
                now={workNow}
                canRetry={Boolean(sessionId) && execution.ready && !turnLive}
                onRetry={text => { void submit(text) }}
                onSupply={supplyWork}
                onOpenSession={openWorkerSession}
                onOpenFile={(path, line) => setFilePreview({ path, line })}
                onOpenInbox={() => setBotChat(true)}
                botLabel={botLabel}
                chat={isBotSession}
              />
            )}
            {thread.drafting && !botChat && !historyLoading ? <p className="live-status"><span className="shimmer">{isBotSession ? chatStatus(thread.activity, t) : (thread.activity || 'Analyzing the request')}</span></p> : null}
          </div>
        </div>
        {botChat || historyLoading ? null : <TurnRail root={scrollRef} marks={marks} busyId={thread.drafting && thread.turn != null ? `turn:${thread.turn}` : undefined} />}
        </div>
        <div className="composer-wrap" hidden={botChat}>
          <form
            className="column"
            onSubmit={event => {
              event.preventDefault()
              void send()
            }}
          >
            <div className="card">
              {mentionOpen ? (
                <div className="mention-menu" role="listbox" aria-label={t('composer.mention')}>
                  {mentionChoices.length === 0 ? <p className="mention-empty">{t('composer.noBot')}</p> : mentionChoices.map((item, index) => (
                    <button
                      key={item.sessionId}
                      type="button"
                      role="option"
                      aria-selected={index === mentionActive}
                      className={index === mentionActive ? 'active' : ''}
                      onMouseDown={event => {
                        event.preventDefault()
                        chooseMention(item)
                      }}
                    >
                      <span className="bot-badge">BOT</span>
                      <span className="mention-name">{item.label}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <textarea
                ref={draftRef}
                value={draft}
                rows={1}
                placeholder={sessionId ? (workPlaceholder(works, t) ?? (isBotSession && turnLive ? t('composer.interrupt') : bots.has(sessionId) ? t('composer.mentionHint') : t('composer.task'))) : t('composer.pick')}
                disabled={!sessionId}
                onChange={event => {
                  setDraft(event.target.value)
                  setCursor(event.target.selectionStart ?? event.target.value.length)
                }}
                onSelect={event => setCursor(event.currentTarget.selectionStart ?? 0)}
                onKeyDown={event => {
                  if (event.nativeEvent.isComposing) return
                  if (mentionOpen && mentionChoices.length > 0) {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      setMentionIndex(index => (index + 1) % mentionChoices.length)
                      return
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      setMentionIndex(index => (index - 1 + mentionChoices.length) % mentionChoices.length)
                      return
                    }
                    if (event.key === 'Enter' || event.key === 'Tab') {
                      event.preventDefault()
                      const target = mentionChoices[mentionActive]
                      if (target) chooseMention(target)
                      return
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setMentionClosed(mentionKey)
                      return
                    }
                  }
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void send()
                  }
                }}
              />
              <div className="card-row">
                <div className="tools" ref={menuRef}>
                  <button
                    type="button"
                    className="add"
                    aria-label={t('composer.add')}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    disabled={!sessionId}
                    onClick={() => setMenuOpen(open => !open)}
                  >
                    <PlusIcon />
                  </button>
                  {menuOpen ? (
                    <div className="plus-menu" role="menu">
                      <button type="button" role="menuitem" onClick={() => insertSlash()}>{t('composer.command')}</button>
                      <button type="button" role="menuitem" onClick={() => insertSlash('/permission read-only')}>Read Only</button>
                      <button type="button" role="menuitem" onClick={() => insertSlash('/permission workspace-write')}>Workspace Write</button>
                      <button type="button" role="menuitem" onClick={() => insertSlash('/permission danger-full-access')}>Full access</button>
                      <p className="plus-note">{t('composer.filesLater')}</p>
                    </div>
                  ) : null}
                  {thread.preset ? (
                    <span className="chip">
                      <PermissionIcon preset={thread.preset} />
                      {presetLabel(thread.preset)}
                    </span>
                  ) : null}
                </div>
                <div className="trailing">
                  {thread.model ? <span className="model">{thread.model}</span> : null}
                  {turnLive ? (
                    <button type="button" className="stop" aria-label={t('composer.cancel')} onClick={() => { void cancel() }}>
                      <span className="stop-icon" />
                    </button>
                  ) : null}
                  {locked ? null : (
                    <button type="submit" className="send" aria-label={t('composer.send')} disabled={!canSend}>
                      <ArrowIcon />
                    </button>
                  )}
                </div>
              </div>
            </div>
            <p className="stats">
              {reason || (!execution.ready ? hostText(execution.reason, execution.reason, t) : statsLine(thread))}
            </p>
          </form>
        </div>
      </section>
      {sessionId && filePreview ? (
        <FilePreview sessionId={sessionId} path={filePreview.path} line={filePreview.line} onClose={() => setFilePreview(null)} />
      ) : null}
      {setupOpen ? (
        <NewSessionSheet
          onClose={() => setSetupOpen(false)}
          onCreated={(id, note, name) => { void finishCreate(id, note, name) }}
        />
      ) : null}
    </div>
  )
}

function BotDot({ signal }: { signal: 'run' | 'wait' | null }) {
  const { t } = useI18n()
  if (!signal) return null
  const waiting = signal === 'wait'
  return <span className={waiting ? 'bot-dot wait' : 'bot-dot'} role="img" aria-label={waiting ? t('bot.waiting') : t('bot.running')} />
}

function statsLine(thread: ThreadState): string {
  const parts: string[] = []
  if (thread.turns != null) parts.push(`${thread.turns} turns`)
  if (thread.steps != null) parts.push(`${thread.steps} steps`)
  return parts.join(' · ')
}

function Transcript({ segments, completed, failures, retries, turnEnds, tickets, now, canRetry, onRetry, onSupply, onOpenSession, onOpenFile, onOpenInbox, botLabel, chat = false }: {
  segments: Segment[]
  completed: Record<number, number>
  failures: Record<number, TurnFailure>
  retries: Record<number, RetryAttempt[]>
  turnEnds: Record<number, string>
  tickets: WorkTicket[]
  now: number
  canRetry: boolean
  onRetry: (text: string) => void
  onSupply: (ticketId: string, text: string) => Promise<string>
  onOpenSession: (sessionId: string) => void
  onOpenFile: (path: string, line?: number) => void
  onOpenInbox: () => void
  botLabel: (sessionId: string) => string
  chat?: boolean
}) {
  const blocks: Array<
    | { type: 'user'; segment: Segment & { kind: 'user' } }
    | { type: 'turn'; turn: number; seconds?: number; segments: Segment[] }
  > = []
  let turnBlock: Extract<(typeof blocks)[number], { type: 'turn' }> | null = null
  const flush = () => {
    if (turnBlock && (turnBlock.segments.length || failures[turnBlock.turn] || retries[turnBlock.turn]?.length)) blocks.push(turnBlock)
    turnBlock = null
  }
  for (const segment of segments) {
    if (segment.kind === 'user') {
      flush()
      if (!isTicketNotice(segment.text)) blocks.push({ type: 'user', segment })
      continue
    }
    const turn = segment.turn ?? -1
    if (!turnBlock || turnBlock.turn !== turn) {
      flush()
      turnBlock = { type: 'turn', turn, seconds: completed[turn], segments: [] }
    }
    turnBlock.segments.push(segment)
  }
  flush()
  const seen = new Set(blocks.flatMap(block => block.type === 'turn' ? [block.turn] : []))
  for (const key of Object.keys(failures)) {
    const turn = Number(key)
    if (!seen.has(turn)) blocks.push({ type: 'turn', turn, seconds: completed[turn], segments: [] })
  }
  const shown = cardsToShow(tickets)
  const byId = new Map(tickets.map(ticket => [ticket.id, ticket]))
  const anchorAt = new Map<string, string>()
  for (const block of blocks) {
    if (block.type !== 'turn') continue
    for (const piece of turnPieces(block.segments)) {
      if (piece.type !== 'activity') continue
      for (const segment of piece.segments) {
        if (segment.kind !== 'tool') continue
        const id = dispatchTicketId(segment)
        if (id && byId.has(id) && !anchorAt.has(id)) anchorAt.set(id, segment.id)
      }
    }
  }
  const latestTurn = blocks.reduce((max, block) => block.type === 'turn' ? Math.max(max, block.turn) : max, -1)
  const open = backgroundOpen(tickets)
  return (
    <>
      {blocks.map((block, index) => block.type === 'user' ? (
        <UserBlock key={block.segment.id} segment={block.segment} botLabel={botLabel} onOpenInbox={onOpenInbox} onOpenFile={onOpenFile} />
      ) : (
        <TurnBlock
          key={`turn-${block.turn}-${block.segments[0]?.id ?? 'failed'}`}
          block={block}
          index={index}
          blocks={blocks}
          failures={failures}
          retries={retries}
          turnEnds={turnEnds}
          latestTurn={latestTurn}
          background={open}
          byId={byId}
          anchorAt={anchorAt}
          now={now}
          canRetry={canRetry}
          onRetry={onRetry}
          onSupply={onSupply}
          onOpenSession={onOpenSession}
          onOpenFile={onOpenFile}
          chat={chat}
        />
      ))}
      {shown.filter(ticket => !anchorAt.has(ticket.id)).map(ticket => (
        <WorkCard key={ticket.id} ticket={ticket} now={now} onSupply={onSupply} onOpen={onOpenSession} />
      ))}
    </>
  )
}

function UserBlock({ segment, botLabel, onOpenInbox, onOpenFile }: {
  segment: Segment & { kind: 'user' }
  botLabel: (sessionId: string) => string
  onOpenInbox: () => void
  onOpenFile: (path: string, line?: number) => void
}) {
  const mail = parseBotMail(segment.text)
  const briefing = parseBriefing(segment.text)
  const { locale } = useI18n()
  const stamp = clock(segment.time, locale)
  if (briefing) return <BriefingCard briefing={briefing} time={stamp} mark={segment.id} onOpenFile={onOpenFile} />
  if (mail) {
    const line = inboxSummary([{ kind: 'in', id: segment.id, seq: segment.seq, time: segment.time, mail }], botLabel)
    return (
      <InboxLine
        who={line?.who ?? 'BOT'}
        preview={line?.preview ?? ''}
        time={stamp}
        mark={segment.id}
        onOpen={onOpenInbox}
      />
    )
  }
  return (
    <div className="user-row" data-turn={segment.id}>
      <div className="user-bubble">{segment.text}</div>
      {stamp ? <time>{stamp}</time> : null}
    </div>
  )
}

function promptForTurn(blocks: Array<{ type: string; segment?: Segment & { kind: 'user' }; turn?: number }>, index: number, turn: number): string {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const block = blocks[cursor]
    if (block?.type === 'user' && block.segment && block.segment.text.trim() !== '') {
      if (parseBotMail(block.segment.text) || parseBriefing(block.segment.text)) continue
      if (block.segment.turn == null || block.segment.turn === turn) return block.segment.text
      break
    }
  }
  return ''
}

function continuedAfter(blocks: Array<{ type: string }>, index: number): boolean {
  return blocks.slice(index + 1).some(block => block.type === 'user')
}

function TurnFailurePanel({ seconds, failure, retries, prompt, continued, canRetry, onRetry, showLabel }: {
  seconds?: number
  failure?: TurnFailure
  retries: RetryAttempt[]
  prompt: string
  continued: boolean
  canRetry: boolean
  onRetry: (text: string) => void
  showLabel: boolean
}) {
  const { t } = useI18n()
  const [used, setUsed] = useState(false)
  if (!failure && retries.length === 0) return null
  const spent = used || continued
  return (
    <div className="turn-failure">
      {showLabel ? <p className="turn-failed-label">Failed{seconds != null ? <> · <span className="duration">{seconds}s</span></> : null}</p> : null}
      {retries.map(attempt => (
        <details key={`${attempt.retryId}:${attempt.retry}`} className="retry-row" open={attempt.state === 'scheduled'}>
          <summary>
            {attempt.state === 'started' ? 'Retried model request' : 'Retrying model request'} ({attempt.retry}/{attempt.maxRetries ?? '∞'}) · {Math.max(1, Math.ceil(attempt.delayMs / 1000))}s
          </summary>
          <p>Retry delay: {Math.round(attempt.delayMs)}ms</p>
          <p>Failure reason: {attempt.message}</p>
        </details>
      ))}
      {failure ? (
        <p className="turn-error" role="status">
          <span className="turn-error-title">This turn failed</span>
          <span>{failure.message}</span>
          {failure.code ? <code>{failure.code}</code> : null}
        </p>
      ) : null}
      {failure && prompt && !spent ? (
        <button type="button" className="retry-turn" disabled={!canRetry} onClick={() => { setUsed(true); onRetry(prompt) }}>{t('bot.retry')}</button>
      ) : null}
    </div>
  )
}

function TurnBlock({ block, index, blocks, failures, retries, turnEnds, latestTurn, background, byId, anchorAt, now, canRetry, onRetry, onSupply, onOpenSession, onOpenFile, chat = false }: {
  block: { type: 'turn'; turn: number; seconds?: number; segments: Segment[] }
  index: number
  blocks: Array<{ type: string; segment?: Segment & { kind: 'user' }; turn?: number }>
  failures: Record<number, TurnFailure>
  retries: Record<number, RetryAttempt[]>
  turnEnds: Record<number, string>
  latestTurn: number
  background: boolean
  byId: Map<string, WorkTicket>
  anchorAt: Map<string, string>
  now: number
  canRetry: boolean
  onRetry: (text: string) => void
  onSupply: (ticketId: string, text: string) => Promise<string>
  onOpenSession: (sessionId: string) => void
  onOpenFile: (path: string, line?: number) => void
  chat?: boolean
}) {
  const { t } = useI18n()
  const pieces = turnPieces(block.segments)
  const hasActivity = pieces.some(piece => piece.type === 'activity')
  const stopped = chat && turnEnds[block.turn] === 'aborted' && !failures[block.turn] && !(block.turn === latestTurn && background)
  return (
    <div>
      <div data-turn={`turn:${block.turn}`}>
        {pieces.map(piece => {
          if (piece.type === 'text') {
            return (
              <div key={piece.segment.id} className={piece.segment.streaming ? 'assistant streaming' : 'assistant'}>
                <MarkdownView text={piece.segment.text} streaming={piece.segment.streaming} onOpenFile={onOpenFile} />
              </div>
            )
          }
          const tools = piece.segments.filter((segment): segment is Segment & { kind: 'tool' } => segment.kind === 'tool')
          return (
            <Fragment key={piece.id}>
              <ActivityGroup segments={piece.segments} quiet={chat} />
              {tools.filter(segment => isBudgetRefusal(segment)).map(segment => (
                <WorkRefusal key={segment.id} text={budgetRefusalText(segment.result, t)} />
              ))}
              {tools.flatMap(segment => {
                const id = dispatchTicketId(segment)
                const ticket = id ? byId.get(id) : undefined
                if (!id || !ticket || anchorAt.get(id) !== segment.id) return []
                return [<WorkCard key={ticket.id} ticket={ticket} now={now} onSupply={onSupply} onOpen={onOpenSession} />]
              })}
            </Fragment>
          )
        })}
        {stopped ? <p className="work-note">{t('bot.stopped')}</p> : null}
        <TurnFailurePanel
          seconds={block.seconds}
          failure={failures[block.turn]}
          retries={retries[block.turn] ?? []}
          prompt={promptForTurn(blocks, index, block.turn)}
          continued={continuedAfter(blocks, index)}
          canRetry={canRetry}
          onRetry={onRetry}
          showLabel={!hasActivity}
        />
        {block.turn === latestTurn && turnEnds[block.turn] === 'aborted' && background ? <p className="work-note">{t('bot.stoppedBackground')}</p> : null}
      </div>
    </div>
  )
}

function Status({ health, usage, execution, model }: {
  health: HealthBody | null
  usage: UsageBody | null
  execution: { ready: boolean; reason: string }
  model: string
}) {
  const { t } = useI18n()
  const up = health?.primary?.reachable === true
  const usageCode = usage && 'code' in usage && typeof usage.code === 'string' ? usage.code : ''
  return (
    <div className="status">
      <p>{up ? t('health.up') : t('health.down')}</p>
      {model ? <p className="muted">{model}</p> : null}
      <p className={execution.ready ? '' : 'muted'}>{execution.ready ? t('health.modelReady') : hostText(execution.reason, execution.reason, t)}</p>
      <p className={usage?.connected ? '' : 'muted'}>{usage?.connected ? t('health.usageReady') : hostText(usageCode, usage?.error || t('health.usageOff'), t)}</p>
      <p className="muted">{t('health.sameSession')}</p>
    </div>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 16.5L20 20.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function PermissionIcon({ preset }: { preset: string }) {
  if (preset === 'read-only' || preset === 'readonly' || preset === 'danger-full-access' || preset === 'auto') {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M6.6 2.15C7.5 1.81 8.5 1.81 9.4 2.15L13.92 3.84V7.12C13.92 11.61 10.56 13.6 8 14.58C5.44 13.6 2.08 11.61 2.08 7.12V3.84L6.6 2.15Z" fill="none" stroke="currentColor" strokeLinejoin="round" />
        {preset === 'danger-full-access' ? <path d="M8 4.4V9.9M8 10.8V11.8" fill="none" stroke="currentColor" /> : null}
        {preset === 'read-only' || preset === 'readonly' ? <path d="M5.09 8.14L7.18 10.24C7.27 10.32 7.4 10.31 7.48 10.23L11.51 5.61" fill="none" stroke="currentColor" /> : null}
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.42 1.68C7.44 1.3 8.56 1.3 9.58 1.68L14.1 3.38C14.29 3.45 14.42 3.63 14.42 3.84V6.49L9.23 2.62C8.44 2.32 7.56 2.32 6.77 2.62L2.58 4.19V7.12C2.58 11.18 5.52 13.06 8 14.04C8.28 13.93 8.56 13.81 8.84 13.67C9.07 13.95 9.33 14.19 9.62 14.41C9.12 14.66 8.64 14.87 8.18 15.04C8.06 15.09 7.94 15.09 7.82 15.04C5.22 14.05 1.58 11.94 1.58 7.12V3.84C1.58 3.63 1.7 3.45 1.9 3.38L6.42 1.68Z" fill="currentColor" />
      <path d="M5.26 6.6H10.74M5.26 9.87H8.33" fill="none" stroke="currentColor" />
      <path d="M10.03 13.22C12.15 11.95 14.58 8.9 14.78 8.64C14.41 8.37 13.68 7.83 13.5 8.1C12.4 9.72 11.31 11.34 10.21 12.95C10.15 13.04 10.09 13.13 10.03 13.22Z" fill="currentColor" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 17V7M7 11.5L12 6.5l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
