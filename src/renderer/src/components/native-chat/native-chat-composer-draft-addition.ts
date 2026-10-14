// What is added to a draft without replacing it: text given back (Stop, a queued card's Edit) and
// images given back or attached. Kept as data, so the same addition can be made again on a draft
// loaded later, or replayed from the journal after a crash.

import { appendReturnedDraftText } from '../../../../shared/returned-draft-text'
import { appendPromptDocumentText } from './native-chat-prompt-document-text'
import { basename } from '@/lib/path'
import type {
  NativeChatComposerDraft,
  NativeChatComposerDraftImage
} from './native-chat-composer-draft-storage'

export type NativeChatComposerDraftAddition = {
  readonly text?: string
  readonly images?: readonly NativeChatComposerDraftImage[]
  /** Only an image the user attaches takes the place of a placeholder with its file name. */
  readonly fromUser?: boolean
}

/**
 * The draft's text and images with the addition made. Text follows the shared returned-text rule,
 * which never adds a paragraph the draft already ends with. `once` is for a replay after a crash,
 * which meets a draft that may already have been saved with the addition.
 */
export function withNativeChatComposerDraftAddition(
  draft: NativeChatComposerDraft,
  addition: NativeChatComposerDraftAddition,
  options: { once?: boolean } = {}
): Pick<NativeChatComposerDraft, 'text' | 'images' | 'document'> {
  // Image ids are unique to a message or attach, so one the draft holds means it was added already,
  // whatever was typed since.
  if (addition.images?.some(({ id }) => draft.images.some((held) => held.id === id))) {
    return { text: draft.text, images: draft.images, document: draft.document }
  }
  const text = appendReturnedDraftText(draft.text, addition.text ?? '')
  const images = [...draft.images]
  for (const { id, path, connectionId } of addition.images ?? []) {
    // One that took a placeholder's place holds that id, so a replay knows it by its file.
    if (options.once && addition.fromUser && images.some((held) => held.path === path)) {
      continue
    }
    const image = { id, path, ...(connectionId ? { connectionId } : {}) }
    const placeholder = addition.fromUser
      ? images.findIndex((held) => held.unavailableName === basename(path))
      : -1
    const replaced = images[placeholder]
    if (replaced) {
      // Its chips name the placeholder's id, so the image takes that id.
      images[placeholder] = { ...image, id: replaced.id }
    } else {
      images.push(image)
    }
  }
  return { text, images, document: appendPromptDocumentText(draft.document, draft.text, text) }
}
