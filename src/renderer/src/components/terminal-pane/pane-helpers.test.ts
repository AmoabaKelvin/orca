import { describe, expect, it } from 'vitest'
import { shellEscapePath } from './pane-helpers'

describe('shellEscapePath', () => {
  it('keeps safe POSIX paths unquoted', () => {
    expect(shellEscapePath('/tmp/file.txt', 'Macintosh')).toBe('/tmp/file.txt')
  })

  it('single-quotes POSIX paths with shell-special characters', () => {
    expect(shellEscapePath("/tmp/it's here.txt", 'Linux')).toBe("'/tmp/it'\\''s here.txt'")
  })

  it('keeps safe Windows paths unquoted', () => {
    expect(shellEscapePath('C:\\Users\\orca\\file.txt', 'Windows')).toBe(
      'C:\\Users\\orca\\file.txt'
    )
  })

  it('double-quotes Windows paths with spaces', () => {
    expect(shellEscapePath('C:\\Users\\orca\\my file.txt', 'Windows')).toBe(
      '"C:\\Users\\orca\\my file.txt"'
    )
  })

  it('double-quotes Windows paths with cmd separators', () => {
    expect(shellEscapePath('C:\\Users\\orca\\a&b.txt', 'Windows')).toBe(
      '"C:\\Users\\orca\\a&b.txt"'
    )
  })
})
