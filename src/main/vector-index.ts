/**
 * 纯 JS 的向量索引，替代 Python 版的 FAISS IndexFlatL2 + IndexIDMap。
 *
 * - 向量存在一块连续的 Float32Array 里，缓存友好
 * - 删除用「与末尾交换」实现 O(dim)，不产生墓碑位
 * - 距离定义与原来完全一致：L2，打分仍是 1 / (1 + distance)
 * - 归一化后 L2 与余弦单调对应，所以排序结论一致
 */
export class VectorIndex {
  dimension = 0
  private data = new Float32Array(0)
  private slotIds: number[] = []
  private slots = new Map<number, number>()
  private capacity = 0
  private length = 0

  get size() {
    return this.length
  }

  reinit(dimension: number) {
    this.dimension = dimension
    this.capacity = 0
    this.length = 0
    this.data = new Float32Array(0)
    this.slotIds = []
    this.slots.clear()
  }

  private grow(min: number) {
    const cap = Math.max(min, this.capacity || 1024, Math.ceil((this.capacity || 1) * 1.6))
    const next = new Float32Array(cap * this.dimension)
    next.set(this.data.subarray(0, this.length * this.dimension))
    this.data = next
    this.capacity = cap
  }

  add(id: number, vector: Float32Array) {
    if (vector.length !== this.dimension) {
      throw new Error(`向量维度不匹配：期望 ${this.dimension}，实际 ${vector.length}`)
    }
    const existing = this.slots.get(id)
    if (existing !== undefined) {
      this.data.set(vector, existing * this.dimension)
      return
    }
    if (this.length >= this.capacity) this.grow(this.length + 1)
    this.data.set(vector, this.length * this.dimension)
    this.slotIds[this.length] = id
    this.slots.set(id, this.length)
    this.length += 1
  }

  /** 全量重建：一次性分配，避免逐个扩容 */
  addMany(ids: number[], flat: Float32Array) {
    const n = ids.length
    if (n === 0) {
      this.reinit(this.dimension)
      return
    }
    this.capacity = n
    this.data = new Float32Array(n * this.dimension)
    this.data.set(flat.subarray(0, n * this.dimension))
    this.slotIds = ids.slice()
    this.slots.clear()
    for (let i = 0; i < n; i++) this.slots.set(ids[i], i)
    this.length = n
  }

  remove(id: number): boolean {
    const slot = this.slots.get(id)
    if (slot === undefined) return false
    const last = this.length - 1
    const d = this.dimension
    if (slot !== last) {
      this.data.copyWithin(slot * d, last * d, last * d + d)
      const movedId = this.slotIds[last]
      this.slotIds[slot] = movedId
      this.slots.set(movedId, slot)
    }
    this.slotIds.length = last
    this.slots.delete(id)
    this.length = last
    return true
  }

  /**
   * Top-K 检索。扫描时比较平方距离（省掉 N 次开方），
   * 只对最终命中的 K 条开方。
   */
  search(query: Float32Array, k: number) {
    const empty = { ids: [] as number[], distances: [] as number[] }
    if (this.dimension === 0 || query.length !== this.dimension) return empty
    const n = this.length
    const cap = Math.min(k, n)
    if (cap <= 0) return empty

    const d = this.dimension
    const bestD = new Float64Array(cap).fill(Infinity)
    const bestSlot = new Int32Array(cap).fill(-1)

    for (let s = 0; s < n; s++) {
      const base = s * d
      let sum = 0
      for (let j = 0; j < d; j++) {
        const diff = query[j] - this.data[base + j]
        sum += diff * diff
      }
      if (sum >= bestD[cap - 1]) continue
      let pos = cap - 1
      while (pos > 0 && bestD[pos - 1] > sum) {
        bestD[pos] = bestD[pos - 1]
        bestSlot[pos] = bestSlot[pos - 1]
        pos -= 1
      }
      bestD[pos] = sum
      bestSlot[pos] = s
    }

    const ids: number[] = []
    const distances: number[] = []
    for (let i = 0; i < cap; i++) {
      if (bestSlot[i] < 0) continue
      ids.push(this.slotIds[bestSlot[i]])
      distances.push(Math.sqrt(bestD[i]))
    }
    return { ids, distances }
  }
}

export const vectorIndex = new VectorIndex()
