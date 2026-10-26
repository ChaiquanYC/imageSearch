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

  const evaluate = (expression) =>
    send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })

  fs.mkdirSync(OUT, { recursive: true })

  const shots = [
    ['search', '01-search'],
    ['library', '02-library'],
    ['settings', '03-settings']
  ]

  for (const [route, name] of shots) {
    await evaluate(`window.location.hash = '${route}'`)
    await new Promise((r) => setTimeout(r, 1400))
    // 无 GPU 环境下合成器可能滞后一帧，先丢一帧再取
    await send('Page.captureScreenshot', { format: 'png' })
    await new Promise((r) => setTimeout(r, 400))
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    const file = path.join(OUT, `${name}.png`)
    fs.writeFileSync(file, Buffer.from(data, 'base64'))
    console.log('[capture]', file)
  }

  ws.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
