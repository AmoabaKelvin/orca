import { describe, expect, it } from 'vitest'
import { advancePacedText, pacedTextEnd, type PacedTextMotion } from './use-native-chat-paced-text'

describe('pacedTextEnd', () => {
  it('finishes the word the pace is inside', () => {
    expect(pacedTextEnd('hello brave world', 7, true)).toBe('hello brave'.length)
  })

  it('holds back a word the text ends inside while more may arrive', () => {
    expect(pacedTextEnd('hello bra', 7, true)).toBe('hello '.length)
  })

  it('draws that word once nothing more is coming', () => {
    expect(pacedTextEnd('hello bra', 7, false)).toBe('hello bra'.length)
  })

  it('moves a character at a time through a script written without spaces', () => {
    expect(pacedTextEnd('こんにちは世界', 3, true)).toBe(3)
  })

  it('never stops inside an emoji', () => {
    const text = 'ok 👍👍 done'
    for (let position = 0; position <= text.length; position += 1) {
      const drawn = text.slice(0, pacedTextEnd(text, position, false))
      expect(drawn.isWellFormed()).toBe(true)
    }
  })
})

/** Draws `chunks` (arrival ms, chars) at 60 frames a second; the speed drawn at each frame. */
function speedsOver(chunks: readonly (readonly [number, number])[]): number[] {
  let motion: PacedTextMotion = { position: 0, charsPerSecond: 0 }
  let received = 0
  let next = 0
  const speeds: number[] = []
  const lastArrival = chunks.at(-1)?.[0] ?? 0
  for (let now = 0; now <= lastArrival; now += 1000 / 60) {
    while (next < chunks.length && chunks[next][0] <= now) {
      received += chunks[next][1]
      next += 1
    }
    motion = advancePacedText(motion, received, 1 / 60)
    speeds.push(motion.charsPerSecond)
  }
  return speeds
}

describe('advancePacedText', () => {
  // The shape a real reply reaches the renderer in: a snapshot every 100 ms or so, some far apart.
  const stream = Array.from({ length: 60 }, (_, index): [number, number] => [
    index * 110 + (index % 7 === 0 ? 300 : 0),
    index % 5 === 0 ? 120 : 30
  ])

  it('never jumps its speed when a snapshot lands', () => {
    const speeds = speedsOver(stream)
    const largestChange = Math.max(
      ...speeds.slice(1).map((speed, index) => Math.abs(speed - speeds[index]))
    )
    const typicalSpeed = speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length
    expect(largestChange).toBeLessThan(typicalSpeed * 0.15)
  })

  it('keeps the reader within a moment of the agent', () => {
    let motion: PacedTextMotion = { position: 0, charsPerSecond: 0 }
    for (let frame = 0; frame < 90; frame += 1) {
      motion = advancePacedText(motion, 600, 1 / 60)
    }
    expect(motion.position).toBeGreaterThan(590)
  })

  it('does not draw a long hidden wait in one frame', () => {
    const motion = advancePacedText({ position: 0, charsPerSecond: 5000 }, 10_000, 30)
    expect(motion.position).toBeLessThan(10_000 / 2)
  })

  it('stops at the end of the text', () => {
    expect(advancePacedText({ position: 99.9, charsPerSecond: 900 }, 100, 1 / 60)).toEqual({
      position: 100,
      charsPerSecond: expect.any(Number)
    })
  })
})
