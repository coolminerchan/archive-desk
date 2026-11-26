import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

// This helper runs outside both product directories. Existing files stay intact.
const [nodePid, hostPid, executable, logDirectory] = process.argv.slice(2)
const alive = pid => { try { process.kill(Number(pid), 0); return true } catch (error) { return error.code !== 'ESRCH' } }
try {
  if (![nodePid, hostPid].every(pid => /^[1-9]\d*$/.test(pid)) || !executable || resolve(executable) !== executable)
    throw new Error('Invalid update handoff')
  const started = Date.now()
  while (alive(nodePid) || alive(hostPid)) {
    if (Date.now() - started > 60000) throw new Error('The previous application has not closed')
    await new Promise(ok => setTimeout(ok, 200))
  }
  const child = spawn(executable, [], { detached: true, stdio: 'ignore', windowsHide: false })
  await new Promise((ok, fail) => { child.once('spawn', ok); child.once('error', fail) })
  child.unref()
} catch (error) {
  if (logDirectory) await writeFile(join(logDirectory, 'update-start-error.json'), JSON.stringify({ at: new Date().toISOString(), message: error.message })).catch(() => {})
  process.exitCode = 1
}
