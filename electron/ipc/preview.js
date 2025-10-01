import { Worker } from 'node:worker_threads'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 维护进行中的预览任务：jobId -> Worker
const previewJobs = new Map()

export function registerPreviewIpc(ipcMain, isDev) {
  ipcMain.handle('preview:render', async (_evt, payload) => {
    try {
      const jobId = payload?.jobId || `job_${Date.now()}_${Math.random().toString(36).slice(2)}`
      // 若已有同名任务，先取消
      try { const old = previewJobs.get(jobId); if (old) { old.terminate(); previewJobs.delete(jobId) } } catch {}
  const workerUrl = new URL('./preview-worker.js', import.meta.url)
  const worker = new Worker(workerUrl, { workerData: payload, type: 'module' })
  try { worker.setMaxListeners(0) } catch {}
      previewJobs.set(jobId, worker)
      const result = await new Promise((resolve) => {
        let settled = false
        worker.on('message', (msg) => { if (!settled) { settled = true; resolve(msg) } })
        worker.on('error', (err) => { if (!settled) { settled = true; resolve({ ok: false, error: String(err?.message || err) }) } })
        worker.on('exit', (_code) => { if (!settled) { settled = true; resolve({ ok: false, error: 'worker exited' }) } })
      })
      try { worker.terminate() } catch {}
      previewJobs.delete(jobId)
      return result
    } catch (e) {
      console.error('[preview:render] error', e)
      return { ok: false, error: `[preview:render] ${String(e?.message || e)}` }
    }
  })

  // 取消预览：根据 jobId 终止进行中的 worker
  ipcMain.handle('preview:cancel', async (_evt, jobId) => {
    try {
      const w = previewJobs.get(jobId)
      if (w) {
        try { await w.terminate() } catch {}
        previewJobs.delete(jobId)
      }
      return true
    } catch { return false }
  })
}
