const path = require('path')
const { spawn } = require('child_process')
const { chromium } = require('playwright')

const RUNS = 3
const PORT = 5173
const APP_URL = `http://127.0.0.1:${PORT}/?benchmarkRuns=${RUNS}`

function avg(values) {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function toMb(bytes) {
  return bytes / (1024 * 1024)
}

function waitForServerReady(proc, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    let settled = false

    const onData = (chunk) => {
      const text = String(chunk)
      if (text.includes('Local:') || text.includes('127.0.0.1') || text.includes('ready in')) {
        settled = true
        cleanup()
        resolve()
      }
    }

    const onExit = (code) => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error(`Vite dev server exited early with code ${code}`))
    }

    const cleanup = () => {
      proc.stdout?.off('data', onData)
      proc.stderr?.off('data', onData)
      proc.off('exit', onExit)
    }

    proc.stdout?.on('data', onData)
    proc.stderr?.on('data', onData)
    proc.on('exit', onExit)

    const timer = setInterval(() => {
      if (settled) {
        clearInterval(timer)
        return
      }
      if (Date.now() - start > timeoutMs) {
        settled = true
        clearInterval(timer)
        cleanup()
        reject(new Error('Timed out waiting for Vite server'))
      }
    }, 250)
  })
}

async function runMode(mode) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-precise-memory-info'],
  })

  try {
    const context = await browser.newContext()
    const page = await context.newPage()

    let loaded = false
    let lastError = null
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 30000 })
        loaded = true
        break
      } catch (error) {
        lastError = error
        await page.waitForTimeout(500)
      }
    }

    if (!loaded) {
      throw lastError || new Error('Failed to load benchmark page')
    }

    const buttonText =
      mode === 'default'
        ? 'Run isolated large reload (default only)'
        : 'Run isolated large reload (lazy only)'
    await page.getByRole('button', { name: buttonText }).click()
    await page.getByText('Run details', { exact: true }).waitFor({ timeout: 240000 })

    await page.waitForFunction(
      (expectedRows) => document.querySelectorAll('tbody tr').length === expectedRows,
      RUNS,
      { timeout: 240000 },
    )

    const metrics = await page.evaluate(() => {
      const readCell = (row, idx) => row.children[idx]?.textContent?.trim() || ''
      const parseMs = (value) => Number(value.replace(' ms', '').trim())
      const parseBytes = (value) => {
        if (value.endsWith(' B')) return Number(value.replace(' B', '').trim())
        if (value.endsWith(' KB')) return Number(value.replace(' KB', '').trim()) * 1024
        if (value.endsWith(' MB')) return Number(value.replace(' MB', '').trim()) * 1024 * 1024
        return 0
      }

      const rows = Array.from(document.querySelectorAll('tbody tr'))
      const runRows = rows.map((row) => ({
        mode: readCell(row, 0),
        startupMs: parseMs(readCell(row, 1)),
        firstQueryMs: parseMs(readCell(row, 2)),
        startupCacheSizeBytes: parseBytes(readCell(row, 3)),
        fullCacheSizeBytes: parseBytes(readCell(row, 4)),
        persistedEntryBytes: parseBytes(readCell(row, 5)),
        startupTotalHeapBytes: parseBytes(readCell(row, 6)),
      }))

      const cards = Array.from(document.querySelectorAll('.summary-grid article'))
      const heapCard = cards.find((card) =>
        (card.querySelector('h2')?.textContent || '').includes('Average Startup JS Heap Snapshot'),
      )

      const lines = heapCard ? Array.from(heapCard.querySelectorAll('p')).map((p) => p.textContent || '') : []
      const parseLine = (prefix) => {
        const line = lines.find((entry) => entry.startsWith(prefix))
        if (!line) return 0
        return parseBytes(line.slice(prefix.length).trim())
      }

      const summary = {
        defaultStartupHeapUsedBytes: parseLine('default used heap:'),
        lazyStartupHeapUsedBytes: parseLine('lazy used heap:'),
        defaultStartupTotalHeapBytes: parseLine('default total JS heap:'),
        lazyStartupTotalHeapBytes: parseLine('lazy total JS heap:'),
      }

      return { runRows, summary }
    })

    return metrics
  } finally {
    await browser.close()
  }
}

function aggregate(results) {
  return {
    startupMs: avg(results.map((r) => r.startupMs)),
    firstQueryMs: avg(results.map((r) => r.firstQueryMs)),
    startupCacheSizeBytes: avg(results.map((r) => r.startupCacheSizeBytes)),
    fullCacheSizeBytes: avg(results.map((r) => r.fullCacheSizeBytes)),
    persistedEntryBytes: avg(results.map((r) => r.persistedEntryBytes)),
    startupTotalHeapBytes: avg(results.map((r) => r.startupTotalHeapBytes)),
  }
}

async function main() {
  const cwd = __dirname
  const devServer = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--strictPort', '--port', `${PORT}`], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  devServer.stdout?.on('data', (chunk) => process.stdout.write(chunk))
  devServer.stderr?.on('data', (chunk) => process.stderr.write(chunk))

  try {
    await waitForServerReady(devServer)
    const defaultResult = await runMode('default')
    const lazyResult = await runMode('lazy')
    const defaultRuns = defaultResult.runRows
    const lazyRuns = lazyResult.runRows

    const defaultAvg = aggregate(defaultRuns)
    const lazyAvg = aggregate(lazyRuns)

    const summary = {
      runs: RUNS,
      profile: 'large-reload',
      environment: 'web-isolated-browser-context',
      average: {
        default: defaultAvg,
        lazy: lazyAvg,
      },
      summaryAveragesFromUi: {
        defaultStartupHeapUsedBytes: defaultResult.summary.defaultStartupHeapUsedBytes,
        lazyStartupHeapUsedBytes: lazyResult.summary.lazyStartupHeapUsedBytes,
        startupHeapUsedDeltaBytes:
          defaultResult.summary.defaultStartupHeapUsedBytes - lazyResult.summary.lazyStartupHeapUsedBytes,
        defaultStartupTotalHeapBytes: defaultResult.summary.defaultStartupTotalHeapBytes,
        lazyStartupTotalHeapBytes: lazyResult.summary.lazyStartupTotalHeapBytes,
        startupTotalHeapDeltaBytes:
          defaultResult.summary.defaultStartupTotalHeapBytes - lazyResult.summary.lazyStartupTotalHeapBytes,
      },
      deltaDefaultMinusLazy: {
        startupMs: defaultAvg.startupMs - lazyAvg.startupMs,
        firstQueryMs: defaultAvg.firstQueryMs - lazyAvg.firstQueryMs,
        startupCacheSizeBytes: defaultAvg.startupCacheSizeBytes - lazyAvg.startupCacheSizeBytes,
        persistedEntryBytes: defaultAvg.persistedEntryBytes - lazyAvg.persistedEntryBytes,
        fullCacheSizeBytes: defaultAvg.fullCacheSizeBytes - lazyAvg.fullCacheSizeBytes,
        startupTotalHeapBytes: defaultAvg.startupTotalHeapBytes - lazyAvg.startupTotalHeapBytes,
      },
      startupCacheSizeMb: {
        default: toMb(defaultAvg.startupCacheSizeBytes),
        lazy: toMb(lazyAvg.startupCacheSizeBytes),
      },
    }

    console.log(JSON.stringify(summary, null, 2))
  } finally {
    if (devServer.pid) {
      process.kill(devServer.pid, 'SIGTERM')
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
