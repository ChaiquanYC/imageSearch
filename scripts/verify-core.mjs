import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sqlitePkg from 'node-sqlite3-wasm'
import { VectorIndex } from '../src/main/vector-index.ts'
import { planPathRewrite } from '../src/main/path-rewrite.ts'

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

console.log(`\n通过 ${pass} / 15`)
if (process.exitCode) console.error('存在失败用例')
