import { readFileSync, writeFileSync } from 'node:fs'

const base = '0.1.0'
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const response = await fetch(`https://registry.npmjs.org/${pkg.name}`)
let next = 0
if (response.status !== 404) {
  if (!response.ok) throw new Error(`registry returned ${response.status}`)
  const published = await response.json()
  const pattern = new RegExp(`^${base.replaceAll('.', '\\.')}-beta\\.(\\d+)$`)
  const numbers = Object.keys(published.versions ?? {})
    .map((version) => pattern.exec(version)?.[1])
    .filter((value) => value != null)
    .map(Number)
  if (numbers.length > 0) next = Math.max(...numbers) + 1
}
pkg.version = `${base}-beta.${next}`
writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`)
console.log(pkg.version)
