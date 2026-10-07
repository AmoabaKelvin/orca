import type * as OnigurumaEngine from 'shiki/engine/oniguruma'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadSyntaxTokenizer, loadedSyntaxTokenizer } from './syntax-tokenizer'

const engine = vi.hoisted(() => ({ fails: false }))

vi.mock('shiki/engine/oniguruma', async (importOriginal) => {
  const actual = await importOriginal<typeof OnigurumaEngine>()
  return {
    ...actual,
    createOnigurumaEngine: (...args: Parameters<typeof actual.createOnigurumaEngine>) => {
      if (engine.fails) {
        throw new Error('regex engine unavailable')
      }
      return actual.createOnigurumaEngine(...args)
    }
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('loadSyntaxTokenizer', () => {
  it('retries after a failed load instead of leaving the language plain', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    engine.fails = true

    await expect(loadSyntaxTokenizer('json')).resolves.toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(loadedSyntaxTokenizer('json')).toBeNull()

    engine.fails = false

    await expect(loadSyntaxTokenizer('json')).resolves.not.toBeNull()
    expect(loadedSyntaxTokenizer('JSON')).not.toBeNull()
  })

  it('resolves to null for a language without a grammar', async () => {
    await expect(loadSyntaxTokenizer('not-a-real-language')).resolves.toBeNull()
  })
})
