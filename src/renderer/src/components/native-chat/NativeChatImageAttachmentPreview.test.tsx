// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { NativeChatImageAttachmentPreview } from './NativeChatImageAttachmentPreview'
import type { NativeChatComposerImageAttachment } from './NativeChatComposerField'

const mocks = vi.hoisted(() => ({
  useLocalImageSrc: vi.fn()
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('@/components/editor/useLocalImageSrc', () => ({
  useLocalImageSrc: mocks.useLocalImageSrc
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  mocks.useLocalImageSrc.mockReset()
})

function renderPreview(attachment: NativeChatComposerImageAttachment): void {
  vi.stubGlobal('IntersectionObserver', undefined)
  render(<NativeChatImageAttachmentPreview attachment={attachment} onRemove={vi.fn()} />)
}

describe('NativeChatImageAttachmentPreview', () => {
  it('shows the clipboard thumbnail and a spinner while pending', () => {
    mocks.useLocalImageSrc.mockReturnValue(undefined)
    renderPreview({ id: 'a1', path: '', previewUrl: 'blob:clipboard-1', pending: true })

    expect(document.querySelector('.animate-spin')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Saving pasted image…' }).getAttribute('src')).toBe(
      'blob:clipboard-1'
    )
  })

  it('renders no spinner once the attachment has settled', () => {
    mocks.useLocalImageSrc.mockReturnValue('blob:on-disk-1')
    renderPreview({ id: 'a1', path: '/tmp/example.png' })

    expect(document.querySelector('.animate-spin')).toBeFalsy()
  })

  it('does not read the on-disk file while the attachment is pending', () => {
    mocks.useLocalImageSrc.mockReturnValue(undefined)
    renderPreview({ id: 'a1', path: '', previewUrl: 'blob:clipboard-1', pending: true })

    expect(mocks.useLocalImageSrc).toHaveBeenCalledWith(undefined, '', undefined)
  })

  it('offers the full-size file, not the clipboard thumbnail, to the chat copy menu', () => {
    mocks.useLocalImageSrc.mockReturnValue('blob:on-disk-1')
    renderPreview({ id: 'a1', path: '/tmp/example.png', previewUrl: 'data:thumbnail' })

    const thumbnail = screen.getByRole('button', { name: 'View image: example.png' })
    expect(thumbnail.getAttribute('data-native-chat-copy-image-src')).toBe('blob:on-disk-1')
  })

  it('offers nothing to copy until the file is readable, for SVG, or in the web client', () => {
    mocks.useLocalImageSrc.mockReturnValue(undefined)
    renderPreview({ id: 'a1', path: '/tmp/example.png', previewUrl: 'data:thumbnail' })
    expect(
      screen
        .getByRole('button', { name: 'View image: example.png' })
        .hasAttribute('data-native-chat-copy-image-src')
    ).toBe(false)

    mocks.useLocalImageSrc.mockReturnValue('blob:on-disk-2')
    renderPreview({ id: 'a2', path: '/tmp/logo.SVG' })
    expect(
      screen
        .getByRole('button', { name: 'View image: logo.SVG' })
        .hasAttribute('data-native-chat-copy-image-src')
    ).toBe(false)

    vi.stubGlobal('__ORCA_WEB_CLIENT__', true)
    renderPreview({ id: 'a3', path: '/tmp/shot.png' })
    expect(
      screen
        .getByRole('button', { name: 'View image: shot.png' })
        .hasAttribute('data-native-chat-copy-image-src')
    ).toBe(false)
  })

  it('stays open when a close comes from using the chat context menu', () => {
    mocks.useLocalImageSrc.mockReturnValue('blob:on-disk-1')
    renderPreview({ id: 'a1', path: '/tmp/example.png', previewUrl: 'data:thumbnail' })
    fireEvent.click(screen.getByRole('button', { name: 'View image: example.png' }))
    expect(
      within(screen.getByRole('dialog'))
        .getByRole('img')
        .getAttribute('data-native-chat-copy-image-src')
    ).toBe('blob:on-disk-1')
    const menu = document.body.appendChild(document.createElement('div'))
    menu.setAttribute('data-native-chat-context-menu', '')
    const copyItem = menu.appendChild(document.createElement('div'))

    // Radix's dismissal after a menu click arrives while the item still has focus. An open menu
    // pauses the dialog's focus trap, which this test has no menu to do, so pin focus directly.
    const activeElement = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(copyItem)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeTruthy()

    // Clicking X moves focus off the menu, so the close goes through even with it still fading.
    activeElement.mockRestore()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    menu.remove()
  })
})
