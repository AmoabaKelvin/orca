import { useEffect, useState, type ComponentProps } from 'react'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { cn } from '@/lib/utils'
import './native-chat-markdown.css'

/** True from the frame after `fadeWords` turns on, so nothing present at that moment fades. */
function useWordFadeArmed(fadeWords: boolean): boolean {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!fadeWords) {
      setArmed(false)
      return
    }
    const frame = requestAnimationFrame(() => setArmed(true))
    return () => cancelAnimationFrame(frame)
  }, [fadeWords])
  return armed && fadeWords
}

export function NativeChatMarkdown({
  className,
  fadeWords = false,
  ...props
}: ComponentProps<typeof CommentMarkdown>): React.JSX.Element {
  const wordFadeArmed = useWordFadeArmed(fadeWords)
  return (
    <CommentMarkdown
      {...props}
      fadeWords={fadeWords}
      // Read by native-chat-markdown.css: only words appended while it is set fade in.
      data-word-fade={wordFadeArmed ? '' : undefined}
      className={cn('native-chat-markdown', className)}
    />
  )
}
