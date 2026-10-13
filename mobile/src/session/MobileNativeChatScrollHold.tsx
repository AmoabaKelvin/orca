import { Component, type RefObject } from 'react'
import { Platform } from 'react-native'

type ScrollNode = { scrollTop: number; scrollHeight: number }

type Props = {
  /** The first row's key: a change in it is rows changing above the reader. */
  headKey: string | undefined
  /** On the page the list's scrollable node is its DOM element. */
  listRef: RefObject<{ getScrollableNode: () => ScrollNode | null | undefined } | null>
}

/** Keeps the page's view on the same rows when rows above it change, by keeping its distance from
 *  the end. A class because only `getSnapshotBeforeUpdate` reads the position before the new rows
 *  are in the document. A native list holds its own place (`maintainVisibleContentPosition`). */
export class MobileNativeChatScrollHold extends Component<Props> {
  getSnapshotBeforeUpdate(previous: Props): ScrollNode | null {
    if (Platform.OS !== 'web' || previous.headKey === this.props.headKey) {
      return null
    }
    const node = this.props.listRef.current?.getScrollableNode()
    return node ? { scrollTop: node.scrollTop, scrollHeight: node.scrollHeight } : null
  }

  componentDidUpdate(_previous: Props, _state: unknown, before: ScrollNode | null): void {
    const node = before ? this.props.listRef.current?.getScrollableNode() : null
    if (before && node) {
      node.scrollTop = before.scrollTop + (node.scrollHeight - before.scrollHeight)
    }
  }

  render(): null {
    return null
  }
}
