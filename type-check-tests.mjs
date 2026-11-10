import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = dirname(fileURLToPath(import.meta.url))
const config = ts.readConfigFile(`${root}/tsconfig.strict-tests.json`, ts.sys.readFile)
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
const program = ts.createProgram(parsed.fileNames, parsed.options)
const diagnostics = ts.getPreEmitDiagnostics(program).filter(diagnostic => (
  diagnostic.file && /\/test\/[^/]+\.ts$/.test(diagnostic.file.fileName)
))

if (diagnostics.length === 0) process.exit(0)

for (const diagnostic of diagnostics) {
  const start = diagnostic.start ?? 0
  const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(start)
  const file = diagnostic.file.fileName.replace(/.*\/plugins\/dsh-bot\//, '')
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  console.error(`${file}:${line + 1}:${character + 1} TS${diagnostic.code} ${message}`)
}
process.exit(1)
