import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sqlitePkg from 'node-sqlite3-wasm'
import { VectorIndex } from '../src/main/vector-index.ts'
import { planPathRewrite } from '../src/main/path-rewrite.ts'
import { UnionFind } from '../src/main/hash.ts'
import { signatureFromRgb, signatureSimilarity } from '../src/main/signature.ts'
import { migrateDirectoryContents } from '../src/main/migrate.ts'
import { parseTags, joinTags } from '../src/shared/types.ts'
import { openStore, getStore, closeStore } from '../src/main/database.ts'

const { Database } = sqlitePkg

let pass = 0
function check(name, fn) {
  try {
    fn()
    pass += 1
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`  FAIL ${name}`)
    console.error(err)
    process.exitCode = 1
  }
}

console.log('\n[1] VectorIndex')

check('空索引检索返回空结果', () => {
  const idx = new VectorIndex()
  idx.reinit(4)
  const r = idx.search(new Float32Array([1, 0, 0, 0]), 5)
  assert.deepStrictEqual(r.ids, [])
})

check('按距离排序返回 Top-K', () => {
  const idx = new VectorIndex()
  idx.reinit(3)
  idx.add(10, new Float32Array([1, 0, 0]))
  idx.add(20, new Float32Array([0.9, 0.1, 0]))
  idx.add(30, new Float32Array([0, 1, 0]))
  const r = idx.search(new Float32Array([1, 0, 0]), 2)
  assert.deepStrictEqual(r.ids, [10, 20])
  assert.ok(r.distances[0] <= r.distances[1])
  assert.strictEqual(r.distances[0], 0)
})

check('k 大于总量时返回全部', () => {
  const idx = new VectorIndex()
  idx.reinit(2)
  idx.add(1, new Float32Array([1, 0]))
  idx.add(2, new Float32Array([0, 1]))
  assert.strictEqual(idx.search(new Float32Array([1, 0]), 99).ids.length, 2)
})

check('删除后不残留（含末尾交换）', () => {
  const idx = new VectorIndex()
  idx.reinit(2)
  idx.add(1, new Float32Array([1, 0]))
  idx.add(2, new Float32Array([0, 1]))
  idx.add(3, new Float32Array([0.7, 0.7]))
  assert.strictEqual(idx.remove(1), true)
  assert.strictEqual(idx.size, 2)
  const r = idx.search(new Float32Array([1, 0]), 5)
  assert.deepStrictEqual(r.ids.sort((a, b) => a - b), [2, 3])
})

check('删除不存在的 id 返回 false', () => {
  const idx = new VectorIndex()
  idx.reinit(2)
  assert.strictEqual(idx.remove(404), false)
})

check('重复 add 同一 id 覆盖而非追加', () => {
  const idx = new VectorIndex()
  idx.reinit(2)
  idx.add(1, new Float32Array([1, 0]))
  idx.add(1, new Float32Array([0, 1]))
  assert.strictEqual(idx.size, 1)
  const r = idx.search(new Float32Array([0, 1]), 1)
  assert.deepStrictEqual(r.ids, [1])
  assert.strictEqual(r.distances[0], 0)
})

check('addMany 全量重建', () => {
  const idx = new VectorIndex()
  idx.reinit(2)
  idx.add(9, new Float32Array([1, 1]))
  idx.addMany([5, 6], new Float32Array([1, 0, 0, 1]))
  assert.strictEqual(idx.size, 2)
  const r = idx.search(new Float32Array([0, 1]), 5)
  assert.deepStrictEqual(r.ids.sort((a, b) => a - b), [5, 6])
})

check('维度不符时抛出明确错误', () => {
  const idx = new VectorIndex()
  idx.reinit(3)
  assert.throws(() => idx.add(1, new Float32Array([1, 0])), /维度不匹配/)
})

check('扩容后数据不丢（1500 条越过初始容量）', () => {
  const idx = new VectorIndex()
  idx.reinit(8)
  for (let i = 0; i < 1500; i++) {
    const v = new Float32Array(8)
    v[i % 8] = 1
    idx.add(1000 + i, v)
  }
  assert.strictEqual(idx.size, 1500)
  const r = idx.search(new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]), 3)
  assert.strictEqual(r.ids.length, 3)
})

console.log('\n[2] 存储路径前缀改写 SQL')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'is-verify-'))
const dbFile = path.join(tmp, 'test.db')
const db = new Database(dbFile)
db.exec(`
  CREATE TABLE images (id INTEGER PRIMARY KEY AUTOINCREMENT, image_path TEXT);
`)
const insert = db.prepare('INSERT INTO images (image_path) VALUES (?)')
const rewrite = db.prepare(
  "UPDATE images SET image_path = ? || SUBSTR(image_path, ?) WHERE image_path LIKE ? ESCAPE '!'"
)
const readAll = db.prepare('SELECT image_path FROM images ORDER BY id')

function doRewrite(oldRoot, newRoot) {
  const plan = planPathRewrite(oldRoot, newRoot)
  if (!plan) return 0
  return rewrite.run([plan.prefix, plan.startIndex, plan.likePattern]).changes
}

const oldRoot = 'C:\\a\\b'
insert.run(['C:\\a\\b\\c.png'])
insert.run(['C:\\a\\b\\sub\\d.jpg'])
insert.run(['C:\\a\\bb\\e.png'])
insert.run(['D:\\other\\f.png'])

check('只改写真正在该目录下的记录', () => {
  const changed = doRewrite(oldRoot, 'D:\\x\\y')
  assert.strictEqual(changed, 2, '应只影响 2 条')
})

check('改写后路径拼接正确（分隔符不丢）', () => {
  const rows = readAll.all().map((r) => r.image_path)
  assert.ok(rows.includes('D:\\x\\y\\c.png'), `实际: ${rows.join(' | ')}`)
  assert.ok(rows.includes('D:\\x\\y\\sub\\d.jpg'), `实际: ${rows.join(' | ')}`)
})

check('前缀相似的其他目录不被误改', () => {
  const rows = readAll.all().map((r) => r.image_path)
  assert.ok(rows.includes('C:\\a\\bb\\e.png'))
  assert.ok(rows.includes('D:\\other\\f.png'))
})

check('旧根目录带尾部分隔符也能正确处理', () => {
  insert.run(['C:\\p\\q\\g.png'])
  doRewrite('C:\\p\\q\\', 'E:\\m')
  const rows = readAll.all().map((r) => r.image_path)
  assert.ok(rows.includes('E:\\m\\g.png'), `实际: ${rows.join(' | ')}`)
})

check('新旧目录相同时不改动', () => {
  const before = readAll
    .all()
    .map((r) => r.image_path)
    .join('|')
  const changed = doRewrite('E:\\m', 'E:\\m')
  const after = readAll
    .all()
    .map((r) => r.image_path)
    .join('|')
  assert.strictEqual(changed, 0)
  assert.strictEqual(before, after)
})

check('路径里的 _ 不被当成 LIKE 通配符', () => {
  insert.run(['C:\\my_pics\\h.png'])
  insert.run(['C:\\myXpics\\i.png'])
  const changed = doRewrite('C:\\my_pics', 'F:\\z')
  const rows = readAll.all().map((r) => r.image_path)
  assert.strictEqual(changed, 1, '只应命中 my_pics 目录下的 1 条')
  assert.ok(rows.includes('F:\\z\\h.png'), `实际: ${rows.join(' | ')}`)
  assert.ok(rows.includes('C:\\myXpics\\i.png'), 'myXpics 不应被误改')
})

insert.finalize()
rewrite.finalize()
readAll.finalize()
db.close()
fs.rmSync(tmp, { recursive: true, force: true })

/* ---------------- 查重签名 ---------------- */
console.log('\n[3] 感知签名与查重判定')

const solidRgb = (r, g, b, size = 256) => {
  const buf = new Uint8Array(size * size * 3)
  for (let i = 0; i < size * size; i++) {
    buf[i * 3] = r
    buf[i * 3 + 1] = g
    buf[i * 3 + 2] = b
  }
  return buf
}

const sigRed = signatureFromRgb(256, 256, solidRgb(214, 48, 49))
const sigRedBrighter = signatureFromRgb(256, 256, solidRgb(222, 56, 57))
const sigOrange = signatureFromRgb(256, 256, solidRgb(230, 126, 34))
const sigRedSmall = signatureFromRgb(64, 64, solidRgb(214, 48, 49, 64))

check('签名长度固定为 8×8×3', () => {
  assert.strictEqual(sigRed.length, 192)
})

check('同一张图签名相似度为 1', () => {
  assert.strictEqual(signatureSimilarity(sigRed, sigRed), 1)
})

check('纯色图缩放后签名不变（同图不同尺寸）', () => {
  assert.ok(signatureSimilarity(sigRed, sigRedSmall) > 0.99)
})

check('亮度微调仍判定为重复（>0.95）', () => {
  const score = signatureSimilarity(sigRed, sigRedBrighter)
  assert.ok(score > 0.95, `实际 ${score.toFixed(3)}`)
})

check('不同颜色不会被误判成重复（<0.95）', () => {
  const score = signatureSimilarity(sigRed, sigOrange)
  assert.ok(score < 0.95, `实际 ${score.toFixed(3)}`)
})

check('长度不一致时返回 0', () => {
  assert.strictEqual(signatureSimilarity(sigRed, new Uint8Array(10)), 0)
})

check('并查集能合并传递关系', () => {
  const uf = new UnionFind()
  uf.union(1, 2)
  uf.union(2, 3)
  assert.strictEqual(uf.find(1), uf.find(3))
  assert.notStrictEqual(uf.find(1), uf.find(4))
})

/* ---------------- 标签解析 ---------------- */
console.log('\n[4] 标签解析')

check('parseTags 去空白、去空项', () => {
  assert.deepStrictEqual(parseTags(' 海报 ,, 暖色 , '), ['海报', '暖色'])
  assert.deepStrictEqual(parseTags(''), [])
  assert.deepStrictEqual(parseTags(null), [])
})

check('joinTags 去重且忽略大小写', () => {
  assert.strictEqual(joinTags(['A', 'a', 'b']), 'A,b')
})

check('joinTags 清理逗号与换行', () => {
  assert.strictEqual(joinTags(['a,b', 'c\nd']), 'a b,c d')
})

/* ---------------- 真实数据库行为 ---------------- */
console.log('\n[5] 数据库 schema 迁移与筛选')

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'is-db-'))
const legacy = new Database(path.join(dbDir, 'image.db'))
legacy.exec(`
  CREATE TABLE images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_path TEXT NOT NULL,
    vector_data BLOB,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`)
legacy.prepare('INSERT INTO images (image_path, description) VALUES (?, ?)').run([
  'C:////legacy////a.png',
  '老库里的记录'
])
legacy.close()

openStore(dbDir)

check('老库自动补齐新增列且数据不丢', () => {
  const stats = getStore().getStatistics(384, 384)
  assert.strictEqual(stats.total, 1)
  assert.strictEqual(stats.withTags, 0)
  assert.strictEqual(stats.trashed, 0)
})

const store = getStore()
const vec = new Float32Array([1, 0, 0, 0])
const idB = store.addImage({
  path: 'C:////lib////b.png',
  vector: vec,
  description: '海边日落暖色调',
  tags: ['风景', '暖色'],
  contentHash: 'hash-b',
  fileSize: 100
})
const idC = store.addImage({
  path: 'C:////lib////c.png',
  vector: vec,
  description: '城市夜景霓虹',
  tags: ['夜景'],
  contentHash: 'hash-c',
  fileSize: 200
})
const idD = store.addImage({
  path: 'C:////lib////my_pic.png',
  vector: vec,
  description: '',
  tags: [],
  contentHash: 'hash-d',
  fileSize: 300
})

check('按内容哈希命中已有记录', () => {
  assert.strictEqual(store.findIdByHash('hash-b'), idB)
  assert.strictEqual(store.findIdByHash('hash-nope'), null)
})

check('按标签精确筛选（_ 不作通配符）', () => {
  const page = store.getPage({ page: 1, pageSize: 10, tag: '风景' })
  assert.strictEqual(page.total, 1)
  assert.strictEqual(page.rows[0].id, idB)
})

check('标签里的下划线不被当成通配符', () => {
  store.updateTags(idD, ['my_pic'])
  const hit = store.getPage({ page: 1, pageSize: 10, tag: 'my_pic' })
  assert.strictEqual(hit.total, 1)
  const miss = store.getPage({ page: 1, pageSize: 10, tag: 'myXpic' })
  assert.strictEqual(miss.total, 0)
})

check('关键词同时匹配描述与标签', () => {
  const byDesc = store.getPage({ page: 1, pageSize: 10, keyword: '日落' })
  assert.strictEqual(byDesc.total, 1)
  const byTag = store.getPage({ page: 1, pageSize: 10, keyword: '夜景' })
  assert.strictEqual(byTag.total, 1)
  const byName = store.getPage({ page: 1, pageSize: 10, keyword: 'b.png' })
  assert.ok(byName.total >= 1)
})

check('只看有描述过滤生效', () => {
  const page = store.getPage({ page: 1, pageSize: 10, onlyWithDescription: true })
  assert.strictEqual(page.total, 3, '老库那条 + b + c，d 没有描述')
})

check('软删除后从列表与检索中消失', () => {
  store.trash([idC])
  const page = store.getPage({ page: 1, pageSize: 50 })
  assert.ok(!page.rows.some((r) => r.id === idC))
  assert.strictEqual(store.getInfoById(idC), null)
  assert.strictEqual(store.getPage({ page: 1, pageSize: 10, trash: true }).total, 1)
})

check('恢复后重新出现在列表', () => {
  store.restore([idC])
  const page = store.getPage({ page: 1, pageSize: 50 })
  assert.ok(page.rows.some((r) => r.id === idC))
})

check('统计口径排除回收站记录', () => {
  const before = getStore().getStatistics(384, 384)
  store.trash([idC])
  const after = getStore().getStatistics(384, 384)
  assert.strictEqual(after.total, before.total - 1)
  assert.strictEqual(after.trashed, before.trashed + 1)
  store.restore([idC])
})

check('排序：描述升序把空描述排到最后', () => {
  const page = store.getPage({ page: 1, pageSize: 50, sort: 'description' })
  const last = page.rows[page.rows.length - 1]
  assert.strictEqual(last.id, idD)
})

check('列表返回解析后的标签数组', () => {
  const page = store.getPage({ page: 1, pageSize: 50 })
  const row = page.rows.find((r) => r.id === idB)
  assert.deepStrictEqual(row.tags, ['风景', '暖色'])
})

check('appendTagsBatch 追加而不覆盖', () => {
  store.appendTagsBatch([idB], ['精选'])
  const row = store.getPage({ page: 1, pageSize: 50 }).rows.find((r) => r.id === idB)
  assert.deepStrictEqual(row.tags, ['风景', '暖色', '精选'])
})

check('标签统计按数量排序', () => {
  const tags = store.listTags()
  assert.ok(tags.length >= 2)
  assert.ok(tags.every((t) => t.count >= 1))
})

check('彻底删除后记录与哈希都不再存在', () => {
  const paths = store.purge([idD])
  assert.deepStrictEqual(paths, ['C:////lib////my_pic.png'])
  assert.strictEqual(store.findIdByHash('hash-d'), null)
})

check('清空回收站只删回收站里的记录', () => {
  store.trash([idC])
  const totalBefore = getStore().getStatistics(384, 384).total
  const paths = store.purgeAllTrash()
  assert.strictEqual(paths.length, 1)
  assert.strictEqual(getStore().getStatistics(384, 384).total, totalBefore)
  assert.strictEqual(getStore().getStatistics(384, 384).trashed, 0)
})

closeStore()
fs.rmSync(dbDir, { recursive: true, force: true })

/* ---------------- 目录迁移 ---------------- */
console.log('\n[6] 目录迁移（移动 / 复制）')

const mv = fs.mkdtempSync(path.join(os.tmpdir(), 'is-mv-'))
const src = path.join(mv, 'src')
const dst = path.join(mv, 'dst')
fs.mkdirSync(src, { recursive: true })
fs.writeFileSync(path.join(src, 'a.png'), 'aaa')
fs.mkdirSync(path.join(src, 'sub'), { recursive: true })
fs.writeFileSync(path.join(src, 'sub', 'b.png'), 'bbb')

check('移动模式搬完清空源目录', () => {
  const n = migrateDirectoryContents(src, dst, 'move')
  assert.strictEqual(n, 2)
  assert.ok(fs.existsSync(path.join(dst, 'a.png')))
  assert.ok(fs.existsSync(path.join(dst, 'sub', 'b.png')))
  // 搬空后源目录本身也会被回收，两种情况都算通过
  assert.ok(!fs.existsSync(src) || fs.readdirSync(src).length === 0, '源目录应为空')
})

check('移动后文件内容完整', () => {
  assert.strictEqual(fs.readFileSync(path.join(dst, 'sub', 'b.png'), 'utf-8'), 'bbb')
})

fs.mkdirSync(path.join(src, 'x'), { recursive: true })
fs.writeFileSync(path.join(src, 'x', 'c.png'), 'ccc')
check('复制模式保留源目录', () => {
  const dst2 = path.join(mv, 'dst2')
  migrateDirectoryContents(src, dst2, 'copy')
  assert.ok(fs.existsSync(path.join(src, 'x', 'c.png')), '源文件应保留')
  assert.ok(fs.existsSync(path.join(dst2, 'x', 'c.png')))
})

check('目标是源的子目录时拒绝执行', () => {
  assert.throws(
    () => migrateDirectoryContents(src, path.join(src, 'inner'), 'move'),
    /子目录/
  )
})

check('源不存在时报错', () => {
  assert.throws(() => migrateDirectoryContents(path.join(mv, 'nope'), dst, 'move'), /不存在/)
})

fs.rmSync(mv, { recursive: true, force: true })

console.log(`\n通过 ${pass} / ${pass + (process.exitCode ? 1 : 0)}`)
if (process.exitCode) console.error('存在失败用例')
