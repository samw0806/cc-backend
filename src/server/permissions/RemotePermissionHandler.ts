import type { PermissionRule } from '../../core/types.js'

export class RemotePermissionHandler {
  private rules: PermissionRule[]

  constructor(rules: PermissionRule[]) {
    // 将字符串 toolPattern 转为 RegExp
    this.rules = rules.map(r => ({
      ...r,
      toolPattern: typeof r.toolPattern === 'string' && r.toolPattern.startsWith('^')
        ? new RegExp(r.toolPattern)
        : r.toolPattern
    }))
  }

  checkPermission(toolName: string, toolInput: any): {
    behavior: 'allow' | 'deny' | 'ask'
    reason?: string
  } {
    for (const rule of this.rules) {
      if (this.matchesRule(toolName, toolInput, rule)) {
        return { behavior: rule.behavior, reason: rule.reason }
      }
    }
    return { behavior: 'ask' }
  }

  private matchesRule(toolName: string, toolInput: any, rule: PermissionRule): boolean {
    if (typeof rule.toolPattern === 'string') {
      if (toolName !== rule.toolPattern) return false
    } else if (rule.toolPattern instanceof RegExp) {
      if (!rule.toolPattern.test(toolName)) return false
    }

    if (rule.inputPattern) {
      return this.matchesInputPattern(toolInput, rule.inputPattern)
    }

    return true
  }

  private matchesInputPattern(input: any, pattern: any): boolean {
    if (typeof pattern === 'object' && pattern !== null) {
      for (const key in pattern) {
        const patternValue = pattern[key]
        const inputValue = input?.[key]
        if (patternValue instanceof RegExp) {
          if (!patternValue.test(String(inputValue ?? ''))) return false
        } else if (patternValue !== inputValue) {
          return false
        }
      }
    }
    return true
  }

  addRule(rule: PermissionRule) { this.rules.push(rule) }
  removeRule(index: number) { this.rules.splice(index, 1) }
  getRules(): PermissionRule[] { return [...this.rules] }
}
