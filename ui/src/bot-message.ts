export interface BotMail {
  id: string
  from: string
  correlation: string
  causation: string
  hop: string
  note: string
  body: string
}

/** Parse one inbound foundations message. Other user text stays a normal bubble. */
export function parseBotMail(text: string): BotMail | null {
  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('[foundations:message]')) return null
  const rest = normalized.slice('[foundations:message]'.length).replace(/^\n/, '')
  const splitAt = rest.indexOf('\n---\n')
  if (splitAt < 0) return null
  const fields: Record<string, string> = {}
  const notes: string[] = []
  for (const line of rest.slice(0, splitAt).split('\n')) {
    const match = /^(id|from|correlation|causation|hop):\s*(.*)$/.exec(line)
    if (match?.[1]) fields[match[1]] = (match[2] ?? '').trim()
    else if (line.trim() !== '') notes.push(line.trim())
  }
  if (!fields.from) return null
  return {
    id: fields.id ?? '',
    from: fields.from,
    correlation: fields.correlation ?? '',
    causation: fields.causation ?? '',
    hop: fields.hop ?? '',
    note: notes.join(' '),
    body: rest.slice(splitAt + '\n---\n'.length).trim(),
  }
}

export function mailLabel(from: string, known: string): string {
  if (known !== '' && known !== from) return known
  if (from.startsWith('session-') && from.length > 18) return `${from.slice(0, 12)}…${from.slice(-4)}`
  return from
}
