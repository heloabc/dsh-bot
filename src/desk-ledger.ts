/** Desk idempotency ledger. Separate from the work-ticket table. One JSON file, replaced atomically. */

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * @param {string} file
 */
export function openLedger(file) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  let state: LedgerFile = { sessions: {}, tasks: {} }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      state = {
        sessions: parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {},
        tasks: parsed.tasks && typeof parsed.tasks === 'object' ? parsed.tasks : {},
      }
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code !== 'ENOENT') throw error
  }
  const tasksOf = () => Object.values(state.tasks)
  const save = () => {
    const next = `${file}.${process.pid}.tmp`
    writeFileSync(next, JSON.stringify(state), { mode: 0o600 })
    renameSync(next, file)
  }
  return {
    /**
     * @param {string} key
     * @param {string} sessionId
     */
    rememberSession(key, sessionId) {
      const existing = state.sessions[key]
      if (existing) return existing
      const record = { sessionId, createdAt: new Date().toISOString() }
      state.sessions[key] = record
      save()
      return record
    },
    /** @param {string} key */
    session(key) {
      return state.sessions[key]
    },
    /**
     * @param {string} key
     * @param {Omit<TaskRecord, 'id' | 'createdAt'>} input
     */
    rememberTask(key, input) {
      const existing = state.tasks[key]
      if (existing) return { record: existing, created: false }
      const record = { id: randomUUID(), createdAt: new Date().toISOString(), ...input }
      state.tasks[key] = record
      save()
      return { record, created: true }
    },
    /**
     * @param {string} id
     * @returns {TaskRecord | undefined}
     */
    task(id) {
      return tasksOf().find(item => item.id === id)
    },
    /**
     * @param {string} id
     * @param {Partial<TaskRecord>} patch
     */
    updateTask(id, patch) {
      const key = Object.entries(state.tasks).find(([, item]) => item.id === id)?.[0]
      if (key === undefined) return undefined
      state.tasks[key] = { ...state.tasks[key], ...patch, id }
      save()
      return state.tasks[key]
    },
    tasks() {
      return tasksOf().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    },
  }
}

/**
 * @param {string} value
 * @returns {boolean}
 */
export function validIdempotencyKey(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{8,200}$/.test(value)
}

export interface TaskRecord {
  id: string
  createdAt: string
  sessionId: string
  status: 'blocked_unconfigured' | 'accepted' | 'failed' | 'cancel_requested' | 'cancelled'
  reason: string
  upstreamCode?: string
}

interface SessionRecord {
  sessionId: string
  createdAt: string
}

interface LedgerFile {
  sessions: Record<string, SessionRecord>
  tasks: Record<string, TaskRecord>
}
