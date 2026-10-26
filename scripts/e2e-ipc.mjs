import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { encodePNG, draw, solid } from './lib-png.mjs'

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
        return reject(
          new Error(msg.result.exceptionDetails.text + ' ' + (result?.description ?? ''))
        )
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
  const run = (expr) => evaluate(ws, expr)
  const call = (method, ...args) =>
    run(`window.api.${method}(${args.map((a) => JSON.stringify(a)).join(', ')})`)

  /* ---------- 基础能力 ---------- */
  check('preload 暴露 window.api', (await run('typeof window.api === "object"')) === true)

  const info = await call('info')
  check(
    'app:info 返回版本与可用后端',
    Boolean(info?.electron) && Array.isArray(info?.availableDevices),
    `electron ${info?.electron} · ${info?.availableDevices?.join('/')} · GPU ${info?.gpuName ?? 'n/a'}`
  )

  const settings = await call('getSettings')
  check(
    'settings 含新增字段',
    Boolean(settings?.storageDir) && settings?.migrateMode === 'move',
    `migrateMode=${settings?.migrateMode} · device=${settings?.device}`
  )

  const modelState = await call('getModelState')
  check(
    '模型就绪且维度正确',
    modelState?.ready === true && modelState?.dimension === 384,
    `${modelState?.dimension} 维 · ${modelState?.device}`
  )

  /* ---------- 列表 / 筛选 ---------- */
  const before = await call('getPage', { page: 1, pageSize: 200 })
  const beforeTotal = before.total
  const beforeIds = new Set(before.rows.map((r) => r.id))
  check('读取图库分页（新签名）', beforeTotal > 0, `${beforeTotal} 条`)
  check('返回标签数组', Array.isArray(before.rows[0]?.tags), `首行标签 ${before.rows[0]?.tags?.join('/')}`)

  const tagList = await call('listTags')
  check('标签列表可读', Array.isArray(tagList) && tagList.length > 0, `共 ${tagList.length} 个标签`)
  const firstTag = tagList[0]?.tag
  const tagged = await call('getPage', { page: 1, pageSize: 200, tag: firstTag })
  check(
    '按标签筛选生效',
    tagged.total === tagList[0]?.count,
    `标签「${firstTag}」→ ${tagged.total} 条`
  )

  const byKeyword = await call('getPage', { page: 1, pageSize: 200, keyword: '渐变' })
  check('关键词筛选生效', byKeyword.total > 0 && byKeyword.total < beforeTotal, `命中 ${byKeyword.total} 条`)

  const sorted = await call('getPage', { page: 1, pageSize: 200, sort: 'oldest' })
  check(
    '排序生效（旧→新）',
    sorted.rows[0]?.createdAt <= sorted.rows[sorted.rows.length - 1]?.createdAt,
    `${sorted.rows[0]?.createdAt}`
  )

  /* ---------- 检索三模式 ---------- */
  const sample = before.rows[0]?.path
  const imageSearch = await call('search', { mode: 'image', k: 12, imagePath: sample })
  check(
    '以图搜图返回 12 条且首条满分',
    imageSearch?.hits?.length === 12 && imageSearch.hits[0].score > 0.99,
    `首条 ${(imageSearch?.hits?.[0]?.score * 100).toFixed(1)}% · ${imageSearch?.elapsedMs}ms`
  )

  const textSearch = await call('search', {
    mode: 'text',
    k: 10,
    text: '海边日落的暖色调照片'
  })
  check(
    '文字搜图命中并带文本分',
    textSearch?.hits?.length > 0 && textSearch.hits[0].textScore !== null,
    `首条「${textSearch?.hits?.[0]?.description}」文 ${(
      (textSearch?.hits?.[0]?.textScore ?? 0) * 100
    ).toFixed(1)}%`
  )

  const hybrid = await call('search', {
    mode: 'hybrid',
    k: 10,
    imagePath: sample,
    text: '红色的纯色背景'
  })
  check(
    '图文混合返回并标注命中来源',
    hybrid?.hits?.length > 0 && hybrid.hits.every((h) => ['image', 'text', 'both'].includes(h.via)),
    `来源分布 ${hybrid?.hits?.map((h) => h.via).join(',')}`
  )

  /* ---------- 导入去重 ---------- */
  // 凭空造一张库里没有的图，避免和演示数据撞哈希
  const stamp = Date.now() % 200
  const freshFile = path.join(os.tmpdir(), `is-e2e-fresh-${stamp}.png`)
  fs.writeFileSync(freshFile, encodePNG(256, 256, draw(solid([40 + stamp, 90, 200]))))

  const importResult = await call('importImages', [freshFile, freshFile])
  check(
    '导入去重：同图第二次被跳过',
    importResult?.succeeded === 1 && importResult?.duplicates === 1,
    `成功 ${importResult?.succeeded} · 跳过重复 ${importResult?.duplicates}`
  )

  const after = await call('getPage', { page: 1, pageSize: 400 })
  const newRows = after.rows.filter((r) => !beforeIds.has(r.id))
  check(
    '导入后总数 +1 且有向量',
    after.total === beforeTotal + 1 && newRows.every((r) => r.hasVector),
    `${beforeTotal} → ${after.total}`
  )
  const newIds = newRows.map((r) => r.id)

  /* ---------- 标签写入 ---------- */
  if (newIds.length) {
    await call('updateTags', newIds[0], ['e2e标签', '临时'])
    const row = (await call('getPage', { page: 1, pageSize: 400 })).rows.find(
      (r) => r.id === newIds[0]
    )
    check('单条标签写入生效', row?.tags?.includes('e2e标签'), row?.tags?.join('/'))

    await call('batchTags', newIds, ['批量标签'], true)
    const row2 = (await call('getPage', { page: 1, pageSize: 400 })).rows.find(
      (r) => r.id === newIds[0]
    )
    check(
      '批量追加标签不覆盖原标签',
      row2?.tags?.includes('e2e标签') && row2?.tags?.includes('批量标签'),
      row2?.tags?.join('/')
    )
  }

  /* ---------- 描述 + 文本向量联动 ---------- */
  if (newIds.length) {
    await call('updateDescription', newIds[0], '一只在雪地里的橘猫')
    const descRow = (await call('getPage', { page: 1, pageSize: 400 })).rows.find(
      (r) => r.id === newIds[0]
    )
    check('描述写入生效', descRow?.description === '一只在雪地里的橘猫')

    const catSearch = await call('search', { mode: 'text', k: 5, text: '雪地里的猫' })
    check(
      '新写的描述立刻进入文本检索',
      catSearch?.hits?.some((h) => h.id === newIds[0]),
      `命中 ${catSearch?.hits?.length} 条`
    )
  }

  /* ---------- 回收站 ---------- */
  if (newIds.length) {
    const trashed = await call('trashImages', newIds)
    const listed = await call('getPage', { page: 1, pageSize: 400 })
    const trashList = await call('getPage', { page: 1, pageSize: 400, trash: true })
    check(
      '移入回收站后主列表不再出现',
      trashed === newIds.length && !listed.rows.some((r) => newIds.includes(r.id)),
      `回收站 ${trashList.total} 条`
    )

    const hitInTrash = await call('search', { mode: 'image', k: 20, imagePath: sample })
    check(
      '回收站记录不参与检索',
      hitInTrash.hits.every((h) => !newIds.includes(h.id)),
      `仍在结果里的已删记录 ${hitInTrash.hits.filter((h) => newIds.includes(h.id)).length}`
    )

    const restored = await call('restoreImages', newIds)
    const afterRestore = await call('getPage', { page: 1, pageSize: 400 })
    check(
      '恢复后重新出现',
      restored === newIds.length && newIds.every((id) => afterRestore.rows.some((r) => r.id === id))
    )

    const purged = await call('purgeImages', newIds)
    const finalList = await call('getPage', { page: 1, pageSize: 400 })
    check(
      '彻底删除清理干净',
      purged === newIds.length && finalList.total === beforeTotal,
      `删 ${purged} 条，回到 ${finalList.total} 条`
    )
  }

  /* ---------- 查重 ---------- */
  const dups = await call('scanDuplicates', 0.95)
  check(
    '查重扫描出预置的重复组',
    Array.isArray(dups?.groups) && dups.groups.length >= 1,
    `${dups?.groups?.length} 组 · 扫描 ${dups?.scanned} 张 · ${dups?.elapsedMs}ms`
  )
  check(
    '重复组包含内容完全相同的判定',
    dups?.groups?.some((g) => g.items.some((i) => i.exact)),
    `精确重复 ${dups?.groups?.flatMap((g) => g.items).filter((i) => i.exact).length} 张`
  )

  /* ---------- 导出 ---------- */
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'is-export-'))
  const exportIds = before.rows.slice(0, 3).map((r) => r.id)
  const exported = await call('exportImages', exportIds, exportDir)
  const files = fs.readdirSync(exportDir)
  check(
    '导出图片与 metadata.csv',
    exported?.exported === 3 &&
      files.filter((f) => f !== 'metadata.csv').length === 3 &&
      files.includes('metadata.csv'),
    `${files.length} 个文件`
  )
  const csv = fs.readFileSync(path.join(exportDir, 'metadata.csv'), 'utf-8')
  check(
    'metadata.csv 带 BOM 且含描述列',
    csv.charCodeAt(0) === 0xfeff && csv.includes('描述') && csv.split('\r\n').length >= 4,
    `${csv.split('\r\n').length - 1} 行数据`
  )
  fs.rmSync(exportDir, { recursive: true, force: true })

  /* ---------- 目录迁移（移动） ---------- */
  const storageDir = settings.storageDir
  const moveTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'is-move-'))
  try {
    const moved = await call('migrate', 'storage', moveTarget, 'move')
    const leftInOld = fs.existsSync(storageDir) ? fs.readdirSync(storageDir).length : 0
    const inNew = fs.readdirSync(moveTarget).length
    check(
      '移动模式：文件搬到新目录且源目录清空',
      leftInOld === 0 && inNew > 0,
      `旧目录剩 ${leftInOld} 项 · 新目录 ${inNew} 项 · 记录 ${moved?.records}`
    )

    const listed = await call('getPage', { page: 1, pageSize: 400 })
    check(
      '迁移后数据库路径已改写',
      listed.rows.every((r) => r.path.startsWith(moveTarget)),
      listed.rows[0]?.path
    )

    const hit = await call('search', { mode: 'image', k: 5, imagePath: listed.rows[0].path })
    check('迁移后检索仍然可用', hit?.hits?.length > 0, `首条 ${(hit.hits[0].score * 100).toFixed(1)}%`)
  } finally {
    // 无论结果如何都搬回原位，避免污染演示数据
    const current = (await call('getSettings')).storageDir
    if (current !== storageDir) {
      await call('migrate', 'storage', storageDir, 'move')
    }
    const left = fs.existsSync(moveTarget) ? fs.readdirSync(moveTarget).length : 0
    check('迁移已回滚到原目录', left === 0, `临时目录剩 ${left} 项`)
    fs.rmSync(moveTarget, { recursive: true, force: true })
  }

  /* ---------- 统计 ---------- */
  const stats = await call('getStats')
  const finalPage = await call('getPage', { page: 1, pageSize: 400 })
  check(
    '统计数字自洽',
    stats.total === finalPage.total && stats.withVector <= stats.total,
    `总 ${stats.total} · 有向量 ${stats.withVector} · 回收站 ${stats.trashed}`
  )

  try {
    fs.rmSync(freshFile, { force: true })
  } catch {
    /* ignore */
  }

  ws.close()
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n[e2e] 通过 ${results.length - failed} / ${results.length}`)
  if (failed) process.exitCode = 1
}

main().catch((err) => {
  console.error('[e2e] 失败', err)
  process.exit(1)
})
