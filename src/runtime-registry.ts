/** @type {Map<string, unknown>} */
const runtimes = new Map()

/**
 * @param {string} dataDir
 * @param {unknown} runtime
 */
export function publishRuntime(dataDir, runtime) {
  if (runtime) runtimes.set(dataDir, runtime)
  else runtimes.delete(dataDir)
}

/**
 * @param {string} dataDir
 */
export function runtimeFor(dataDir) {
  return runtimes.get(dataDir) ?? null
}

/** @type {Map<string, unknown>} */
const workRuntimes = new Map()

/**
 * @param {string} dataDir
 * @param {unknown} runtime
 */
export function publishWorkRuntime(dataDir, runtime) {
  if (runtime) workRuntimes.set(dataDir, runtime)
  else workRuntimes.delete(dataDir)
}

/**
 * @param {string} dataDir
 */
export function workRuntimeFor(dataDir) {
  return workRuntimes.get(dataDir) ?? null
}
