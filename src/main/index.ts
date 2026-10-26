import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, app, dialog, nativeImage, net, protocol, shell } from 'electron'
import { openStore } from './database'
import { loadEmbedder } from './embedder'
import { backfillFingerprints } from './importer'
import { registerIpc, reloadIndexFromDb, setWindowGetter } from './ipc'
import { ensureDirs, getSettings } from './settings'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'thumb',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

let mainWindow: BrowserWindow | null = null

/**
 * 缩略图缓存。真实相册里一张照片动辄几千像素，
 * 直接交给 CSS 缩放到 70px 会让解码开销和内存暴涨，
 * 所以这里用原生解码生成小图并缓存。
 */
const thumbCache = new Map<string, Buffer>()
const THUMB_CACHE_MAX = 600

async function handleThumb(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const target = url.searchParams.get('p')
  if (!target) return new Response('missing path', { status: 400 })
  const size = Number(url.searchParams.get('s') || 0)

  if (!size) {
    try {
      return await net.fetch(pathToFileURL(target).toString())
    } catch {
      return new Response('not found', { status: 404 })
    }
  }

  const key = `${size}|${target}`
  const cached = thumbCache.get(key)
  if (cached) {
    return new Response(new Uint8Array(cached), {
      headers: { 'content-type': 'image/png', 'cache-control': 'max-age=3600' }
    })
  }

  try {
    const image = await nativeImage.createThumbnailFromPath(target, {
      width: size,
      height: size
    })
    if (image.isEmpty()) throw new Error('empty thumbnail')
    const buffer = image.toPNG()
    if (thumbCache.size >= THUMB_CACHE_MAX) thumbCache.clear()
    thumbCache.set(key, buffer)
    return new Response(new Uint8Array(buffer), {
      headers: { 'content-type': 'image/png', 'cache-control': 'max-age=3600' }
    })
  } catch {
    // 某些平台不支持缩略图 API，回退到原图
    try {
      return await net.fetch(pathToFileURL(target).toString())
    } catch {
      return new Response('not found', { status: 404 })
    }
  }
}

function argValue(flag: string): string | null {
  // 同时支持 --flag=value 与 --flag value 两种写法
  const inline = process.argv.find((a) => a.startsWith(`${flag}=`))
  if (inline) return inline.slice(flag.length + 1)
  const idx = process.argv.indexOf(flag)
  if (idx === -1) return null
  const next = process.argv[idx + 1]
  return next && !next.startsWith('--') ? next : null
}

function createWindow(route: string) {
  const win = new BrowserWindow({    width: 1280,
    height: 880,
    minWidth: 1060,
    minHeight: 700,
    show: false,
    backgroundColor: '#F7F8FA',
    title: 'ImageSearch Pro',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  })

  win.setMenuBarVisibility(false)
  win.once('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    win.loadURL(`${devUrl}#${route}`)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: route })
  }

  return win
}

const BOOT_LOG = () => path.join(app.getPath('userData'), 'boot.log')

function bootLog(message: string) {
  try {
    fs.appendFileSync(BOOT_LOG(), `${new Date().toISOString()} ${message}\n`, 'utf-8')
  } catch {
    /* ignore */
  }
}

async function bootstrap(win: BrowserWindow) {
  const send = (channel: string, payload: unknown) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
  try {
    const settings = getSettings()
    bootLog(`bootstrap start · model=${settings.modelId} dir=${settings.modelDir}`)
    send('model:progress', { stage: 'load', message: '正在加载 DINOv2 模型…' })
    await loadEmbedder(settings, (p) => {
      bootLog(`model ${p.stage} ${p.file ?? ''} ${p.progress ?? ''} ${p.message ?? ''}`)
      send('model:progress', p)
    })
    bootLog('model ready')
    const loaded = reloadIndexFromDb()
    bootLog(`index ready count=${loaded.count} dim=${loaded.dim}`)
    send('app:ready', loaded)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    bootLog(`bootstrap failed: ${message}\n${err instanceof Error ? err.stack : ''}`)
    send('app:error', { message })
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  process.on('uncaughtException', (err) => {
    bootLog(`uncaughtException: ${err?.stack ?? err}`)
    console.error(err)
  })
  process.on('unhandledRejection', (reason) => {
    bootLog(`unhandledRejection: ${reason instanceof Error ? reason.stack : String(reason)}`)
    console.error(reason)
  })

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    bootLog('whenReady fired')
    protocol.handle('thumb', handleThumb)

    const settings = getSettings()
    ensureDirs(settings)

    try {
      openStore(settings.dbFolder)
      bootLog('openStore ok')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[boot] 数据库打开失败', err)
      bootLog(`openStore failed: ${message}`)
      // 截图/自动化场景下不弹阻塞式对话框
      if (!argValue('--screenshot')) {
        dialog.showErrorBox(
          '数据库无法打开',
          `${message}\n\n数据库位置：${settings.dbFolder}\n如果该目录被其他程序占用，请关闭后重试。`
        )
      }
      app.quit()
      return
    }

    registerIpc()
    setWindowGetter(() => mainWindow)

    const route = argValue('--route') ?? 'search'
    mainWindow = createWindow(route)

    await bootstrap(mainWindow)

    // 后台给历史记录补算哈希与签名，让导入去重/查重对老库也生效（不阻塞启动）
    setTimeout(() => {
      void backfillFingerprints((done, total) => {
        if (done >= total) bootLog(`fingerprint backfill done ${total}`)
      }).catch((err) => bootLog(`fingerprint backfill failed: ${err}`))
    }, 3000)

    // 支持 `ImageSearch.exe --query <图片路径>`：启动即用该图检索
    const queryPath = argValue('--query')
    if (queryPath && fs.existsSync(queryPath)) {
      const sendQuery = () => {
        if (!mainWindow || mainWindow.isDestroyed()) return
        mainWindow.webContents.send('search:open', queryPath)
      }
      if (mainWindow.webContents.isLoading()) {
        mainWindow.webContents.once('did-finish-load', () => setTimeout(sendQuery, 800))
      } else {
        setTimeout(sendQuery, 800)
      }
    }

    const shotPath = argValue('--screenshot')
    if (shotPath) {
      // 截图模式的窗口必须真实可见，否则 capturePage 拿不到帧
      if (!mainWindow.isVisible()) mainWindow.show()
      const delay = Number(argValue('--delay') ?? 1800)
      setTimeout(async () => {
        try {
          const image = await Promise.race([
            mainWindow!.webContents.capturePage(),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000))
          ])
          if (!image) {
            console.error('[screenshot] capturePage timeout')
          } else {
            fs.mkdirSync(path.dirname(shotPath), { recursive: true })
            fs.writeFileSync(shotPath, image.toPNG())
            console.log('[screenshot] saved', shotPath)
          }
        } catch (err) {
          console.error('[screenshot] failed', err)
        }
        app.quit()
      }, delay)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow('search')
        void bootstrap(mainWindow)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
