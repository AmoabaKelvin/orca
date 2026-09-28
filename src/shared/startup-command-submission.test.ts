import { describe, expect, it } from 'vitest'
import {
  buildStartupCommandSubmission,
  isBracketedPasteSafeShell
} from './startup-command-submission'

describe('buildStartupCommandSubmission', () => {
  it('submits a single-line command with CR', () => {
    expect(buildStartupCommandSubmission('claude', { bracketedPasteSafe: true })).toBe('claude\r')
    expect(buildStartupCommandSubmission('claude', { bracketedPasteSafe: false })).toBe('claude\r')
  })

  it('replaces a caller-supplied trailing terminator with CR', () => {
    for (const command of ['claude\n', 'claude\r', 'claude\r\n']) {
      expect(buildStartupCommandSubmission(command, { bracketedPasteSafe: true })).toBe('claude\r')
    }
  })

  it('wraps a multiline command in bracketed paste with a trailing submit byte', () => {
    const command = "claude 'first\nsecond'"
    expect(buildStartupCommandSubmission(command, { bracketedPasteSafe: true })).toBe(
      `\x1b[200~${command}\x1b[201~\r`
    )
  })

  it('strips a trailing submit byte before bracket-wrapping the multiline body', () => {
    const body = "claude 'first\nsecond'"
    expect(buildStartupCommandSubmission(`${body}\n`, { bracketedPasteSafe: true })).toBe(
      `\x1b[200~${body}\x1b[201~\r`
    )
  })

  it('keeps the raw path for multiline commands when bracketed paste is unsafe', () => {
    const command = 'echo one\necho two'
    expect(buildStartupCommandSubmission(command, { bracketedPasteSafe: false })).toBe(
      `${command}\r`
    )
  })
})

describe('isBracketedPasteSafeShell', () => {
  it('always trusts bash and zsh', () => {
    for (const shellName of ['bash', 'zsh', 'BASH']) {
      expect(isBracketedPasteSafeShell({ shellName, waitsForShellReady: false })).toBe(true)
    }
  })

  it('trusts fish only behind the shell-ready barrier', () => {
    expect(isBracketedPasteSafeShell({ shellName: 'fish', waitsForShellReady: true })).toBe(true)
    expect(isBracketedPasteSafeShell({ shellName: 'fish', waitsForShellReady: false })).toBe(false)
  })

  it('rejects shells with no known bracketed-paste line editor', () => {
    for (const shellName of ['sh', 'dash', 'nu', 'powershell.exe', '']) {
      expect(isBracketedPasteSafeShell({ shellName, waitsForShellReady: true })).toBe(false)
    }
  })
})
