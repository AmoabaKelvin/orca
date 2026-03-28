import React, { useEffect, useRef } from 'react'

export function LazySection({
  index,
  onVisible,
  children
}: {
  index: number
  onVisible: (index: number) => void
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const triggered = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el || triggered.current) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !triggered.current) {
          triggered.current = true
          onVisible(index)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [index, onVisible])

  return (
    <div ref={ref} className="border-b border-border">
      {children}
    </div>
  )
}
