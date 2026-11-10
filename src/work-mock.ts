import { randomUUID } from 'node:crypto'

/**
 * In-process stand-in for the native inbox and agents.create.
 * It is not a DSH process and not a real model.
 */
export function createMockWorld() {
  /** @type {Map<string, { nextTurn: Array<{ id: string, text: string }>, events: Array<Record<string, unknown>>, seq: number, turn: number }>} */
  const sessions = new Map()
  const calls = []
  const cancels = []
  const pushes = []
  const state = {
    failCreate: false,
    flushMode: 'accepted',
  }

  return {
    calls,
    cancels,
    pushes,
    state,
    session,
    pendingIds(sessionId) {
      return session(sessionId).nextTurn.map(item => item.id)
    },
    events(sessionId) {
      return session(sessionId).events.map(event => ({ ...event }))
    },
    postUser(sessionId, text) {
      const id = randomUUID()
      const slot = session(sessionId)
      slot.nextTurn.push({ id, text })
      append(slot, 'agent/inbox/spliced', { inserted: [{ id }], target: 'next-turn' })
      return id
    },
    claim(sessionId) {
      const slot = session(sessionId)
      const message = slot.nextTurn.shift()
      if (!message) return null
      slot.turn += 1
      append(slot, 'agent/inbox/claimed', { id: message.id, turn: slot.turn })
      return { messageId: message.id, turn: slot.turn, text: message.text }
    },
    seeUser(sessionId, messageId, turn) {
      const slot = session(sessionId)
      append(slot, 'user/message', { id: messageId, turn, message: { id: messageId } })
      return slot.events.at(-1)
    },
    endTurn(sessionId, turn, reasonKind) {
      const slot = session(sessionId)
      append(slot, 'turn/end', { turn, reason: { kind: reasonKind } })
      return slot.events.at(-1)
    },
    toolCall(sessionId, name, args) {
      const slot = session(sessionId)
      append(slot, 'tool/call', { name, arguments: args })
      return slot.events.at(-1)
    },
    assistant(sessionId, text) {
      const slot = session(sessionId)
      append(slot, 'assistant/message', { text, message: { content: [{ type: 'text', text }] } })
      return slot.events.at(-1)
    },
    forgetLog(sessionId, messageId) {
      const slot = session(sessionId)
      slot.events = slot.events.filter(event => !(
        event.type === 'agent/inbox/spliced'
        && Array.isArray(event.data?.inserted)
        && event.data.inserted.some(item => item?.id === messageId)
      ))
      slot.nextTurn = slot.nextTurn.filter(item => item.id !== messageId)
    },
    async createChild(spec) {
      calls.push({ ...spec })
      if (state.failCreate) throw new Error('create failed')
      session(spec.sessionId)
      return spec.sessionId
    },
    async push(sessionId, messageId, text) {
      pushes.push({ sessionId, messageId, text })
      if (state.flushMode === 'fail') return { ok: false, ambiguous: false, seq: null, error: 'push-failed' }
      if (state.flushMode === 'ambiguous') return { ok: false, ambiguous: true, seq: null, error: 'flush-unconfirmed' }
      const slot = session(sessionId)
      if (!slot.nextTurn.some(item => item.id === messageId)) slot.nextTurn.push({ id: messageId, text })
      const seq = append(slot, 'agent/inbox/spliced', { inserted: [{ id: messageId }], target: 'next-turn' })
      return { ok: true, ambiguous: false, seq, target: 'next-turn' }
    },
    async logHas(sessionId, messageId) {
      return session(sessionId).events.some(event => (
        event.type === 'agent/inbox/spliced'
        && Array.isArray(event.data?.inserted)
        && event.data.inserted.some(item => item?.id === messageId)
      ))
    },
    async remove(sessionId, messageId) {
      const slot = session(sessionId)
      const index = slot.nextTurn.findIndex(item => item.id === messageId)
      if (index < 0) return false
      slot.nextTurn.splice(index, 1)
      return true
    },
    async cancel(sessionId, options) {
      cancels.push({ sessionId, keepInbox: options?.keepInbox === true })
    },
    async snapshot(sessionId) {
      return session(sessionId).events.map(event => ({ ...event, data: event.data }))
    },
  }

  /**
   * @param {string} sessionId
   */
  function session(sessionId) {
    let slot = sessions.get(sessionId)
    if (!slot) {
      slot = { nextTurn: [], events: [], seq: 0, turn: 0 }
      sessions.set(sessionId, slot)
    }
    return slot
  }

  /**
   * @param {{ events: Array<Record<string, unknown>>, seq: number }} slot
   * @param {string} type
   * @param {Record<string, unknown>} data
   */
  function append(slot, type, data) {
    slot.seq += 1
    slot.events.push({ type, seq: slot.seq, data })
    return slot.seq
  }
}
