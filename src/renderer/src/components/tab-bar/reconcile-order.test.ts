import { describe, it, expect } from 'vitest'
import { placeIdAfter, reconcileTabOrder } from './reconcile-order'

describe('reconcileTabOrder', () => {
  it('returns all IDs when no stored order exists', () => {
    expect(reconcileTabOrder(undefined, ['t1', 't2'], ['e1'])).toEqual(['t1', 't2', 'e1'])
  })

  it('preserves stored order for existing items', () => {
    expect(reconcileTabOrder(['e1', 't1'], ['t1'], ['e1'])).toEqual(['e1', 't1'])
  })

  it('appends new items at the end', () => {
    expect(reconcileTabOrder(['t1'], ['t1', 't2'], ['e1'])).toEqual(['t1', 't2', 'e1'])
  })

  it('drops stored IDs that no longer exist', () => {
    expect(reconcileTabOrder(['gone', 't1'], ['t1'], [])).toEqual(['t1'])
  })

  it('deduplicates IDs that appear in both terminal and editor lists', () => {
    // Edge case: same ID in both lists should only appear once
    expect(reconcileTabOrder(undefined, ['x'], ['x'])).toEqual(['x'])
  })

  it('handles empty inputs', () => {
    expect(reconcileTabOrder(undefined, [], [])).toEqual([])
    expect(reconcileTabOrder([], [], [])).toEqual([])
  })

  it('maintains interleaved stored order across types', () => {
    const stored = ['t1', 'e1', 't2', 'e2']
    expect(reconcileTabOrder(stored, ['t1', 't2'], ['e1', 'e2'])).toEqual(['t1', 'e1', 't2', 'e2'])
  })
})

describe('placeIdAfter', () => {
  it('inserts the new id immediately after the anchor', () => {
    expect(placeIdAfter(['a', 'b', 'c'], 'new', 'a')).toEqual(['a', 'new', 'b', 'c'])
    expect(placeIdAfter(['a', 'b', 'c'], 'new', 'b')).toEqual(['a', 'b', 'new', 'c'])
  })

  it('appends when the anchor is the last element', () => {
    expect(placeIdAfter(['a', 'b'], 'new', 'b')).toEqual(['a', 'b', 'new'])
  })

  it('appends when the anchor is null or undefined', () => {
    expect(placeIdAfter(['a', 'b'], 'new', null)).toEqual(['a', 'b', 'new'])
    expect(placeIdAfter(['a', 'b'], 'new', undefined)).toEqual(['a', 'b', 'new'])
  })

  it('appends when the anchor is not found', () => {
    expect(placeIdAfter(['a', 'b'], 'new', 'missing')).toEqual(['a', 'b', 'new'])
  })

  it('removes any prior occurrence of the new id before placing it', () => {
    expect(placeIdAfter(['a', 'new', 'b', 'c'], 'new', 'b')).toEqual(['a', 'b', 'new', 'c'])
  })

  it('does not mutate the input array', () => {
    const input = ['a', 'b', 'c']
    placeIdAfter(input, 'new', 'a')
    expect(input).toEqual(['a', 'b', 'c'])
  })

  it('handles the empty-order case', () => {
    expect(placeIdAfter([], 'new', null)).toEqual(['new'])
    expect(placeIdAfter([], 'new', 'missing')).toEqual(['new'])
  })
})
