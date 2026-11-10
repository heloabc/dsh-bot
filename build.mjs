import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = import.meta.dirname
const tsc = spawnSync('tsc', ['-p', 'tsconfig.json', '--pretty', 'false'], {
  cwd: root,
  stdio: 'inherit',
})
if (!existsSync(join(root, 'dist/index.js'))) {
  console.error('tsc did not write dist/index.js')
  process.exit(tsc.status && tsc.status !== 0 ? tsc.status : 1)
}
if (tsc.status !== 0) {
  console.error(`tsc reported type errors (exit ${tsc.status}). dist/ was still written, because these sources type their values in JSDoc.`)
}
