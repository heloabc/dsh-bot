import assert from 'node:assert/strict'
import test from 'node:test'
import { mailLabel, parseBotMail } from './bot-message.ts'

const sample = `[foundations:message]
id: b2fb528b-58c6-4956-8618-710b9064c498
from: session-fd07ebb0-4440-43f5-bf39-7643f629e71e
correlation: 3ab2ee54-802a-4afd-a2ec-64c511d3c037
causation: d2c13922-386b-46f8-b6e9-8b97985940c5
hop: 3
This is an explicit message. It does not include the sender persona, memory, or skills, and it cannot raise permissions.
---
Thanks for the reply.

Call when there is more work.`

test('an inbound bot message keeps the body and hides the transport header', () => {
  const mail = parseBotMail(sample)
  assert.ok(mail)
  assert.equal(mail.from, 'session-fd07ebb0-4440-43f5-bf39-7643f629e71e')
  assert.equal(mail.hop, '3')
  assert.equal(mail.correlation, '3ab2ee54-802a-4afd-a2ec-64c511d3c037')
  assert.match(mail.body, /^Thanks for the reply/)
  assert.match(mail.body, /Call when there is more work\.$/)
  assert.doesNotMatch(mail.body, /foundations:message/)
  assert.equal(parseBotMail('an ordinary sentence'), null)
})

test('a known bot name replaces the session id', () => {
  assert.equal(mailLabel('session-fd07ebb0-4440-43f5-bf39-7643f629e71e', 'Ernie'), 'Ernie')
  assert.equal(mailLabel('session-fd07ebb0-4440-43f5-bf39-7643f629e71e', ''), 'session-fd07…e71e')
})
