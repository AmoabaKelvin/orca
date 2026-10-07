import { useState } from 'react'
import type { NativeChatRecallPosition } from './native-chat-sent-prompt-history'

/**
 * Where prompt recall stands. Ends itself once the composer stops holding the recalled
 * text, whoever changed it: an edit, a send, a returned message, another window's draft.
 */
export function useNativeChatRecallPosition(
  draft: string
): [NativeChatRecallPosition | null, (position: NativeChatRecallPosition | null) => void] {
  const [position, setPosition] = useState<NativeChatRecallPosition | null>(null)
  // Why: the position and its draft come from different stores and may not render together,
  // so only a position already seen in the composer can be ended by a mismatch.
  const [shown, setShown] = useState<NativeChatRecallPosition | null>(null)
  if (position !== null) {
    if (position.recalled === draft) {
      if (shown !== position) {
        setShown(position)
      }
    } else if (shown === position) {
      setPosition(null)
      return [null, setPosition]
    }
  }
  return [position, setPosition]
}
