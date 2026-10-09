import type {
  NativeChatBlock,
  NativeChatToolCallBlock,
  NativeChatToolResultBlock
} from '../../../../shared/native-chat-types'
import {
  editFilesFromToolPair,
  isEditToolName
} from '../../../../shared/native-chat-edit-normalize'
import type { NativeChatEditFile } from '../../../../shared/native-chat-edit-model'
import {
  editFilesFromPatchText,
  type NativeChatEditFileSummary
} from '../../../../shared/native-chat-edit-patch-files'
import { pairToolBlocks } from './native-chat-tool-fold'

const normalizedEdits = new WeakMap<
  NativeChatBlock,
  {
    result: NativeChatBlock | undefined
    files: NativeChatEditFile[] | null
  }
>()

function normalizedEditFiles(
  call: NativeChatBlock,
  result: NativeChatBlock | undefined,
  derive: () => NativeChatEditFile[] | null
): NativeChatEditFile[] | null {
  const cached = normalizedEdits.get(call)
  if (cached && cached.result === result) {
    return cached.files
  }
  const files = derive()
  normalizedEdits.set(call, { result, files })
  return files
}

export type EditCardModel = {
  editCards: Map<NativeChatBlock, { files: NativeChatEditFile[]; key: string }>
  /** Result blocks the card already speaks for, so they render no second row. */
  consumedResults: Set<NativeChatBlock>
}

function editCardFiles(
  call: NativeChatToolCallBlock,
  result: NativeChatToolResultBlock | undefined
): NativeChatEditFile[] | null {
  if (!isEditToolName(call.name)) {
    return null
  }
  const files = normalizedEditFiles(call, result, () =>
    editFilesFromToolPair({
      name: call.name,
      input: call.input,
      ...(call.state ? { state: call.state } : {}),
      ...(result
        ? {
            result: {
              output: result.output,
              isError: result.isError,
              editPatch: result.editPatch
            }
          }
        : {})
    })
  )
  return files?.length ? files : null
}

/** An edit renders as one card, so its result block is folded into the call. The
 *  model decides which calls have landed; a call that has not keeps the generic
 *  tool view, its result still visible as the provider's own error. */
export function buildEditCards(blocks: NativeChatBlock[]): EditCardModel {
  const editCards: EditCardModel['editCards'] = new Map()
  const consumedResults: EditCardModel['consumedResults'] = new Set()
  for (const [index, pair] of pairToolBlocks(blocks).entries()) {
    const call = pair.call
    if (!call) {
      continue
    }
    const files = editCardFiles(call, pair.result)
    if (!files) {
      continue
    }
    editCards.set(call, { files, key: `${call.name}:${index}` })
    if (pair.result) {
      consumedResults.add(pair.result)
    }
  }
  return { editCards, consumedResults }
}

const diffSummaries = new WeakMap<
  NativeChatBlock,
  {
    result: NativeChatBlock | undefined
    files: NativeChatEditFileSummary[] | null
  }
>()

/** The journal's path-only Diff envelope, whose counts read without building its rows. */
function journalDiffSummaryFiles(
  call: NativeChatToolCallBlock,
  result: NativeChatToolResultBlock | undefined
): NativeChatEditFileSummary[] | null {
  if (
    call.state === 'running' ||
    call.state === 'failed' ||
    result?.isError ||
    result?.editPatch ||
    !result?.output
  ) {
    return null
  }
  const input = call.input
  if (
    !input ||
    typeof input !== 'object' ||
    !('path' in input) ||
    typeof input.path !== 'string' ||
    Object.keys(input).some((key) => key !== 'path')
  ) {
    return null
  }
  const cached = diffSummaries.get(call)
  if (cached?.result === result) {
    return cached.files
  }
  const files = editFilesFromPatchText(result.output, input.path, true)
  diffSummaries.set(call, { result, files })
  return files
}

export function buildDiffSummaries(blocks: NativeChatBlock[]): Map<
  NativeChatBlock,
  {
    files: NativeChatEditFileSummary[]
    key: string
  }
> {
  const summaries = new Map<NativeChatBlock, { files: NativeChatEditFileSummary[]; key: string }>()
  for (const [index, pair] of pairToolBlocks(blocks).entries()) {
    const { call, result } = pair
    if (!call) {
      continue
    }
    // Other providers report an edit as the tool call itself, which only normalization can count.
    const files =
      call.name === 'Diff' ? journalDiffSummaryFiles(call, result) : editCardFiles(call, result)
    if (files?.length) {
      summaries.set(call, { files, key: `${call.name}:${index}` })
    }
  }
  return summaries
}
