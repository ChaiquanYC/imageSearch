/**
 * Node 直接跑 .ts 源文件时，extensionless 的相对导入（`../shared/types`）
 * 不会被解析到 .ts。这里补一个解析钩子，让测试脚本可以直接引用源码，
 * 避免为了测试再引一套构建流程。
 */
import { registerHooks } from 'node:module'

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (err) {
      const relative = specifier.startsWith('.') || specifier.startsWith('/')
      const hasExt = /\.[a-z0-9]+$/i.test(specifier)
      if (!relative || hasExt) throw err
      for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
        try {
          return nextResolve(candidate, context)
        } catch {
          /* 继续尝试下一个候选 */
        }
      }
      throw err
    }
  }
})
