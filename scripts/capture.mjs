import fs from 'node:fs'
import path from 'node:path'

const PORT = Number(process.env.CDP_PORT || 9223)
const OUT = process.argv[2] || '.shots'

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
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      const onMessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.id !== id) return
        ws.removeEventListener('message', onMessage)
        if (msg.error) return reject(new Error(JSON.stringify(msg.error)))
        resolve(msg.result)
      }
      ws.addEventListener('message', onMessage)
      ws.send(JSON.stringify({ id, method, params }))
    })

  const run = (expression) =>
    send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })

  const wait = (ms) => new Promise((r) => setTimeout(r, ms))

  /** 无 GPU 时合成器会滞后一帧，先丢一帧再取 */
  async function shot(name) {
    await send('Page.captureScreenshot', { format: 'png' })
    await wait(420)
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    const file = path.join(OUT, `${name}.png`)
    fs.writeFileSync(file, Buffer.from(data, 'base64'))
    console.log('[capture]', file)
  }

  /** React 受控输入：必须用原生 setter 再派发 input 事件 */
  const typeInto = (selector, text) => `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return 'no-element'
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(el, ${JSON.stringify(text)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return 'ok'
    })()
  `

  const clickByText = (selector, text) => `
    (() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((n) => n.textContent.includes(${JSON.stringify(text)}))
      if (!el) return 'no-element'
      el.click()
      return 'ok'
    })()
  `

  const goRoute = async (route) => {
    await run(`window.location.hash = '${route}'`)
    await wait(900)
  }

  fs.mkdirSync(OUT, { recursive: true })

  // SHOT_ONLY=name 时只截当前状态（用于配合 --query 启动的单页截图）
  const only = process.env.SHOT_ONLY
  if (only) {
    await wait(1200)
    await shot(only)
    ws.close()
    return
  }

  /* 1. 文字搜图 */
  await goRoute('search')
  await run(clickByText('.mode-tab', '文字搜图'))
  await wait(300)
  await run(typeInto('.text-search-input', '暖色调的渐变背景'))
  await wait(200)
  await run(clickByText('.text-search-bar .btn', '检索'))
  await wait(2200)
  await shot('01-search-text')

  /* 3. 数据管理 */
  await goRoute('library')
  await wait(1200)
  await shot('03-library')

  /* 4. 查重弹窗 */
  await run(clickByText('.toolbar .btn', '查找重复图'))
  await wait(1800)
  await shot('04-duplicates')
  await run(clickByText('.modal-actions .btn', '关闭'))
  await wait(400)

  /* 5. 回收站视图：先放两张进去，拍完再恢复 */
  await run(clickByText('.view-tab', '图库'))
  await wait(700)
  await run(`
    (() => {
      const boxes = [...document.querySelectorAll('tbody tr')]
        .slice(0, 2)
        .map((tr) => tr.querySelector('input[type=checkbox]'))
        .filter(Boolean)
      boxes.forEach((b) => b.click())
      return boxes.length
    })()
  `)
  await wait(400)
  await run(clickByText('.toolbar .btn', '移入回收站'))
  await wait(500)
  await run(clickByText('.modal-actions .btn', '移入回收站'))
  await wait(900)
  await run(clickByText('.view-tab', '回收站'))
  await wait(1000)
  await shot('05-trash')

  // 恢复回去，别留下脏数据
  await run(`
    (() => {
      const boxes = [...document.querySelectorAll('tbody tr')]
        .map((tr) => tr.querySelector('input[type=checkbox]'))
        .filter(Boolean)
      boxes.forEach((b) => b.click())
      return boxes.length
    })()
  `)
  await wait(400)
  await run(clickByText('.toolbar .btn', '恢复选中'))
  await wait(800)
  await run(clickByText('.view-tab', '图库'))
  await wait(600)

  /* 6. 设置页 */
  await goRoute('settings')
  await wait(1200)
  await shot('06-settings')

  ws.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
