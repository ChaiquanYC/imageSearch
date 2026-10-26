const PORT = Number(process.env.CDP_PORT || 9223)

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  return res.json()
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    ws.onopen = () => resolve(ws)
    ws.onerror = (e) => reject(new Error(`WebSocket 连接失败: ${e?.message ?? e}`))
  })
}

let seq = 0
function evaluate(ws, expression) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    const onMessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id !== id) return
      ws.removeEventListener('message', onMessage)
      if (msg.error) return reject(new Error(JSON.stringify(msg.error)))
      const result = msg.result?.result
      if (msg.result?.exceptionDetails) {
        return reject(new Error(msg.result.exceptionDetails.text + ' ' + (result?.description ?? '')))
      }
      resolve(result?.value)
    }
    ws.addEventListener('message', onMessage)
    ws.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true }
      })
    )
  })
}

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '  ok ' : '  FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  const targets = await listTargets()
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) throw new Error('没找到页面调试目标')
  console.log('[e2e] 连接到', page.title)

  const ws = await connect(page.webSocketDebuggerUrl)

  const hasApi = await evaluate(ws, 'typeof window.api === "object"')
  check('preload 暴露 window.api', hasApi === true)

  const info = await evaluate(ws, 'window.api.info()')
  check('app:info 返回版本', Boolean(info?.electron), `electron ${info?.electron}`)

  const settings = await evaluate(ws, 'window.api.getSettings()')
  check('settings:get 可用', Boolean(settings?.storageDir), settings?.storageDir)

  const modelState = await evaluate(ws, 'window.api.getModelState()')
  check('模型已就绪且维度正确', modelState?.ready === true && modelState?.dimension === 384,
    `${modelState?.dimension} 维`)

  const before = await evaluate(ws, 'window.api.getPage(1, 200)')
  const beforeIds = new Set(before.rows.map((r) => r.id))
  const beforeTotal = before.total
  check('读取图库分页', beforeTotal > 0, `${beforeTotal} 条`)

  const sample = before.rows[0]?.path
  const search = await evaluate(
    ws,
    `window.api.searchByFile(${JSON.stringify(sample)}, 12)`
  )
  check(
    '按图检索返回 12 条且首条满分',
    search?.hits?.length === 12 && search.hits[0].score > 0.99,
    `首条 ${(search?.hits?.[0]?.score * 100).toFixed(1)}% · ${search?.elapsedMs}ms`
  )

  const importResult = await evaluate(
    ws,
    `window.api.importImages([${JSON.stringify(sample)}, ${JSON.stringify(sample)}])`
  )
  check(
    '批量导入 2 张成功',
    importResult?.succeeded === 2 && importResult?.failed === 0,
    `耗时 ${importResult?.elapsedMs}ms`
  )

  const after = await evaluate(ws, 'window.api.getPage(1, 200)')
  const newRows = after.rows.filter((r) => !beforeIds.has(r.id))
  check('导入后总数 +2 且有向量', after.total === beforeTotal + 2 && newRows.every((r) => r.hasVector),
    `${beforeTotal} → ${after.total}`)

  const newIds = newRows.map((r) => r.id)
  const searchAfter = await evaluate(
    ws,
    `window.api.searchByFile(${JSON.stringify(sample)}, 5)`
  )
  const dupHit = searchAfter.hits.filter((h) => newIds.includes(h.id)).length
  check('新导入的图立刻可被检索到', dupHit >= 2, `命中 ${dupHit} 条新记录`)

  if (newIds.length) {
    await evaluate(ws, `window.api.updateDescription(${newIds[0]}, "e2e 临时描述")`)
    const descRow = (await evaluate(ws, 'window.api.getPage(1, 200)')).rows.find(
      (r) => r.id === newIds[0]
    )
    check('单条描述写入生效', descRow?.description === 'e2e 临时描述')

    await evaluate(ws, `window.api.batchDescription(${JSON.stringify(newIds)}, "批量描述")`)
    const batchRows = (await evaluate(ws, 'window.api.getPage(1, 200)')).rows.filter((r) =>
      newIds.includes(r.id)
    )
    check('批量描述写入生效', batchRows.every((r) => r.description === '批量描述'))
  }

  const deleted = await evaluate(ws, `window.api.deleteImages(${JSON.stringify(newIds)})`)
  const final = await evaluate(ws, 'window.api.getPage(1, 200)')
  check(
    '批量删除清理干净',
    deleted === newIds.length && final.total === beforeTotal,
    `删 ${deleted} 条，回到 ${final.total} 条`
  )

  const stats = await evaluate(ws, 'window.api.getStats()')
  check(
    '统计数字自洽',
    stats.total === final.total && stats.withVector <= stats.total,
    `总 ${stats.total} · 有向量 ${stats.withVector}`
  )

  ws.close()
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n[e2e] 通过 ${results.length - failed} / ${results.length}`)
  if (failed) process.exitCode = 1
}

main().catch((err) => {
  console.error('[e2e] 失败', err)
  process.exit(1)
})
