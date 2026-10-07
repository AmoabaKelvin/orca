import { describe, expect, it } from 'vitest'
import { glideAfter } from './use-native-chat-follow-glide'

function restAfter(offset: number, frameMs: number, glideMs: number): number {
  let elapsed = 0
  let rest = offset
  while (rest !== 0) {
    rest = glideAfter(rest, frameMs, glideMs)
    elapsed += frameMs
  }
  return elapsed
}

describe('glideAfter', () => {
  it('comes to rest in the same time whatever the frame rate', () => {
    const at60 = restAfter(300, 1000 / 60, 110)
    const at120 = restAfter(300, 1000 / 120, 110)
    expect(Math.abs(at60 - at120)).toBeLessThan(1000 / 60)
    expect(at60).toBeLessThan(800)
  })

  it('glides back from either side', () => {
    expect(glideAfter(-40, 16, 100)).toBeCloseTo(-glideAfter(40, 16, 100))
    expect(glideAfter(-40, 16, 100)).toBeGreaterThan(-40)
  })

  it('does not treat a long hidden frame as one step to rest', () => {
    expect(glideAfter(300, 5000, 100)).toBeGreaterThan(100)
  })
})
