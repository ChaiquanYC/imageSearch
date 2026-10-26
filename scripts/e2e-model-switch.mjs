const PORT = Number(process.env.CDP_PORT || 9225)

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
  if (!page) throw new Error('没找到页面调试目标')

  const ws = await new Promise((resolve, reject) => {
    const sock = new WebSocket(page.webSocketDebuggerUrl)
    sock.onopen = () => resolve(sock)
    sock.onerror = (e) => reject(new Error(String(e?.message ?? e)))
  })

  let seq = 0
  const evaluate = (expression) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      const onMessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.id !== id) return
        ws.removeEventListener('message', onMessage)
        if (msg.error) return reject(new Error(JSON.stringify(msg.error)))
        if (msg.result?.exceptionDetails) {
          return reject(
            new Error(msg.result.exceptionDetails.text + ' ' + (msg.result.result?.description ?? ''))
          )
        }
        resolve(msg.result?.result?.value)
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

  const results = []
  const check = (name, ok, detail = '') => {
    results.push({ name, ok })
    console.log(`${ok ? '  ok ' : '  FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  }

  const before = await evaluate('window.api.getModelState()')
  console.log(`[switch] 起始模型 ${before.id} / ${before.dtype} / ${before.dimension} 维`)

  const sample = (await evaluate('window.api.getPage(1, 1)')).rows[0].path

  // 1) 切到更大的模型 + int8 量化
  const t0 = Date.now()
  const base = await evaluate(`window.api.switchModel('Xenova/dinov2-base', 'q8')`)
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  check(
    '切到 dinov2-base + int8 成功',
    base?.ready === true && base?.dimension === 768,
    `${base?.dimension} 维 · 耗时 ${elapsed}s`
  )

  const statsB = await evaluate('window.api.getStats()')
  check(
    '切换后自动全量重扫（向量维度一致）',
    statsB.dimension === 768 && statsB.withVector === statsB.total && statsB.total > 0,
    `${statsB.withVector}/${statsB.total} 有向量 · 索引维度 ${statsB.dimension}`
  )

  const search768 = await evaluate(`window.api.searchByFile(${JSON.stringify(sample)}, 5)`)
  check(
    '768 维下检索仍正常',
    search768?.hits?.length === 5 && search768.hits[0].score > 0.99,
    `首条 ${(search768?.hits?.[0]?.score * 100).toFixed(1)}%`
  )

  // 2) 切回小模型 + fp32
  const back = await evaluate(`window.api.switchModel('Xenova/dinov2-small', 'fp32')`)
  check(
    '切回 dinov2-small + fp32 成功',
    back?.ready === true && back?.dimension === 384,
    `${back?.dimension} 维`
  )

  const statsS = await evaluate('window.api.getStats()')
  check(
    '切回后向量再次全量重建',
    statsS.dimension === 384 && statsS.withVector === statsS.total,
    `${statsS.withVector}/${statsS.total} 有向量`
  )

  const search384 = await evaluate(`window.api.searchByFile(${JSON.stringify(sample)}, 5)`)
  check(
    '384 维下检索仍正常',
    search384?.hits?.length === 5 && search384.hits[0].score > 0.99,
    `首条 ${(search384?.hits?.[0]?.score * 100).toFixed(1)}%`
  )

  const settings = await evaluate('window.api.getSettings()')
  check(
    '配置已落盘为最终选择',
    settings.modelId === 'Xenova/dinov2-small' && settings.dtype === 'fp32',
    `${settings.modelId} / ${settings.dtype}`
  )

  ws.close()
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n[switch] 通过 ${results.length - failed} / ${results.length}`)
  if (failed) process.exitCode = 1
}

main().catch((err) => {
  console.error('[switch] 失败', err)
  process.exit(1)
})
