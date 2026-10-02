// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkupOverlay } from './MarkupOverlay'

afterEach(cleanup)

function renderOverlay() {
  const view = render(
    <MarkupOverlay
      baseImage={{ dataUrl: 'data:image/png;base64,', width: 10, height: 10 }}
      busy={false}
      onComplete={vi.fn()}
      onCancel={vi.fn()}
    />
  )
  const canvas = view.container.querySelector('canvas')
  if (!canvas) {
    throw new Error('markup canvas not rendered')
  }
  canvas.setPointerCapture = vi.fn()
  const undoButton = view.getByRole('button', { name: 'Undo' })
  return { canvas, undoButton }
}

function stroke(canvas: HTMLCanvasElement, end: 'pointerUp' | 'pointerCancel'): void {
  act(() => {
    fireEvent.pointerDown(canvas, { pointerId: 1, button: 0, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 50, clientY: 0 })
    fireEvent[end](canvas, { pointerId: 1, clientX: 50, clientY: 0 })
    fireEvent.lostPointerCapture(canvas, { pointerId: 1 })
  })
}

describe('MarkupOverlay canvas pointer wiring', () => {
  it('commits a stroke on release', () => {
    const { canvas, undoButton } = renderOverlay()

    stroke(canvas, 'pointerUp')

    expect(undoButton).toHaveProperty('disabled', false)
  })

  it('discards a stroke whose pointer was cancelled', () => {
    const { canvas, undoButton } = renderOverlay()

    stroke(canvas, 'pointerCancel')

    expect(undoButton).toHaveProperty('disabled', true)
  })
})
