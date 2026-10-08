/** Revealed prose is the evidence for a glide; reflow alone is not new output. */
export type NativeChatFollowGrowth = ReadonlyMap<Element, { length: number; height: number }>

export function readNativeChatFollowGrowth(
  content: HTMLElement | null,
  previous: NativeChatFollowGrowth
): { current: NativeChatFollowGrowth; appendedHeight: number; settled: boolean } {
  const current = new Map<Element, { length: number; height: number }>()
  let appendedHeight = 0
  for (const element of content?.querySelectorAll<HTMLElement>(
    '[data-native-chat-reveal-length]'
  ) ?? []) {
    const length = Number(element.dataset.nativeChatRevealLength)
    const height = element.getBoundingClientRect().height
    current.set(element, { length, height })
    const before = previous.get(element)
    if (length > (before?.length ?? 0)) {
      appendedHeight += Math.max(0, height - (before?.height ?? 0))
    }
  }
  const settled = [...previous.keys()].some((element) => !current.has(element))
  return { current, appendedHeight, settled }
}
