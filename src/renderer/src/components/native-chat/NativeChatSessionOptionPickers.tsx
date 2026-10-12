import { memo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { sortNativeChatSessionOptions } from '../../../../shared/native-chat-session-option-snapshot'
import {
  sessionOptionDispatchUnconfirmed,
  type SessionOptionDescriptor,
  type SessionOptionsSurface,
  type SessionOptionValue
} from '../../../../shared/native-chat-session-options'
import {
  nativeChatModelPillLabel,
  nativeChatOptionValuesLabel,
  nativeChatOptionsPillTitle,
  nativeChatSessionOptionActionLabel,
  nativeChatSessionOptionDisabledReason
} from './native-chat-session-option-labels'
import type { NativeChatOptionPickerRequest } from './native-chat-composer-types'
import { agentSessionThrownFailure } from '../../../../shared/agent-session-write-failure'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import { agentSessionWriteFailureText } from './agent-session-write-notice-text'
import { NativeChatModelCombobox } from './NativeChatModelCombobox'
import { useNativeChatPickerFocusReturn } from './native-chat-picker-focus-return'
import { NativeChatSessionOptionRows } from './NativeChatSessionOptionRows'
import { NativeChatSessionOptionWriteGroup } from './NativeChatSessionOptionWriteGroup'

export type NativeChatSessionOptionPickersProps = {
  surface: SessionOptionsSurface | null
  snapshot: SessionOptionDescriptor[]
  isWorking: boolean
  pickerRequest?: NativeChatOptionPickerRequest | null
  /** Where focus lands after a visit that changed something; see `useNativeChatPickerFocusReturn`. */
  focusComposer?: () => void
}

/** A write in flight. Its value shows at once, and nothing else is sent until it settles. */
type PendingPick = { id: string; value?: SessionOptionValue }

// Why: the picker stays open across a pick, so the choice has to land where it was made before
// the host answers; a refused write falls back to the snapshot.
function withPendingValue(
  descriptor: SessionOptionDescriptor,
  pending: PendingPick | null
): SessionOptionDescriptor {
  if (pending?.id !== descriptor.id) {
    return descriptor
  }
  const { kind } = descriptor
  if (kind.type === 'select' && typeof pending.value === 'string') {
    return {
      ...descriptor,
      valueSource: 'dispatched',
      kind: { ...kind, currentValue: pending.value }
    }
  }
  if (kind.type === 'boolean' && typeof pending.value === 'boolean') {
    return {
      ...descriptor,
      valueSource: 'dispatched',
      kind: { ...kind, currentValue: pending.value }
    }
  }
  return descriptor
}

/** A host's error is words for its log, so it gets the table's; a local surface's error is
 *  already written for the person. */
function optionUpdateFailureDescription(error: unknown): string {
  if (error instanceof RuntimeRpcCallError) {
    return agentSessionWriteFailureText(agentSessionThrownFailure(error, error.code), 'option')
  }
  return error instanceof Error ? error.message : String(error)
}

// Why: value-only visible text must still include the category in the
// accessible name (WCAG 2.5.3 Label in Name / voice control).
function pillAccessibleName(title: string, value: string): string {
  return value === title
    ? title
    : translate('components.native-chat.composer.pillAccessibleName', '{{value0}} {{value1}}', {
        value0: title,
        value1: value
      })
}

function PickerTrigger(props: {
  modelLabel: string
  /** The options' values, shown after the model; empty when there are none to show. */
  optionsLabel: string
  accessibleName: string
  tooltipLabel: string
  disabled: boolean
  disabledReason: string | null
  dispatched: boolean
  triggerRef: React.Ref<HTMLButtonElement>
  onKeyDown: React.KeyboardEventHandler<HTMLButtonElement>
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <PopoverTrigger asChild disabled={props.disabled}>
          <Button
            ref={props.triggerRef}
            type="button"
            variant="ghost"
            size="xs"
            aria-label={props.accessibleName}
            className="max-w-64"
            onKeyDown={props.onKeyDown}
          >
            <span className="truncate text-chat-foreground">{props.modelLabel}</span>
            {props.optionsLabel ? <span className="shrink-0">{props.optionsLabel}</span> : null}
            <ChevronDown className="size-3" />
          </Button>
        </PopoverTrigger>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        <div className="space-y-0.5">
          <div>{props.disabledReason ?? props.tooltipLabel}</div>
          {props.dispatched ? (
            <div>
              {translate(
                'components.native-chat.composer.sentNotConfirmed',
                'Sent to the agent — not confirmed'
              )}
            </div>
          ) : null}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

function SessionOptionPopover(props: {
  model: SessionOptionDescriptor
  options: readonly SessionOptionDescriptor[]
  isWorking: boolean
  /** A write is in flight: nothing else is taken, and the write controls say so. */
  busy: boolean
  /** Read on mount only: the owner remounts to open on request. */
  defaultOpen: boolean
  /** Read on mount only: the option a slash command asked for, focused in place of the search. */
  requestedOptionId: string | null
  onSet: (descriptor: SessionOptionDescriptor, value: SessionOptionValue) => void
  onAction: (descriptor: SessionOptionDescriptor) => void
  focusComposer?: () => void
}): React.JSX.Element {
  const { model, options, busy } = props
  const [open, setOpen] = useState(props.defaultOpen)
  // Spent by the opening it was asked for; a later one focuses the search as usual.
  const requestedOptionId = useRef(props.requestedOptionId)
  const focusReturn = useNativeChatPickerFocusReturn(props.focusComposer)
  const modelTitle = translate('components.native-chat.composer.model', 'Model')
  const modelLabel = nativeChatModelPillLabel(model)
  const modelName = pillAccessibleName(modelTitle, modelLabel)
  const optionsTitle = nativeChatOptionsPillTitle(options)
  const optionsLabel = nativeChatOptionValuesLabel(options)
  const modelReason = nativeChatSessionOptionDisabledReason(model.disabledReason)
  const optionsReason =
    options.length > 0 && options.every((descriptor) => !descriptor.settable)
      ? nativeChatSessionOptionDisabledReason(options[0]?.disabledReason)
      : null

  // Why not sent while busy: the surface drops a write made while another is in flight.
  const set = (descriptor: SessionOptionDescriptor, value: SessionOptionValue): void => {
    if (busy) {
      return
    }
    focusReturn.notePick()
    // Why: effort is the last thing set before typing, so its level closes the picker.
    if (descriptor.id === 'effort') {
      setOpen(false)
    }
    if (descriptor.kind.currentValue !== value) {
      props.onSet(descriptor, value)
    }
  }
  const act = (descriptor: SessionOptionDescriptor): void => {
    if (busy) {
      return
    }
    // Why: agent-picker opens the TUI, and that picker owns focus.
    if (descriptor.action?.type !== 'agent-picker') {
      focusReturn.notePick()
    }
    setOpen(false)
    props.onAction(descriptor)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PickerTrigger
        modelLabel={modelLabel}
        optionsLabel={optionsLabel}
        accessibleName={
          optionsLabel
            ? `${modelName}, ${pillAccessibleName(optionsTitle, optionsLabel)}`
            : modelName
        }
        tooltipLabel={options.length > 0 ? `${modelTitle} · ${optionsTitle}` : modelTitle}
        disabled={props.isWorking}
        disabledReason={modelReason ?? optionsReason}
        dispatched={
          sessionOptionDispatchUnconfirmed(model) || options.some(sessionOptionDispatchUnconfirmed)
        }
        triggerRef={focusReturn.triggerRef}
        // Why: a popover trigger opens on Enter and Space only; a menu also takes ArrowDown.
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      />
      <PopoverContent
        // Why end: the pill's label changes under an open picker; only its right edge stays put.
        align="end"
        side="top"
        collisionPadding={8}
        className="flex w-96 max-w-(--radix-popover-content-available-width) flex-col"
        onOpenAutoFocus={(event) => {
          const content = event.currentTarget
          const optionId = requestedOptionId.current
          requestedOptionId.current = null
          if (!optionId || !(content instanceof HTMLElement)) {
            return
          }
          const row = content.querySelector(`[data-option-id="${CSS.escape(optionId)}"]`)
          const control =
            row?.querySelector<HTMLElement>('[aria-checked="true"]:not(:disabled)') ??
            row?.querySelector<HTMLElement>('button:not(:disabled)')
          if (control) {
            event.preventDefault()
            control.focus()
          }
        }}
        onInteractOutside={focusReturn.onInteractOutside}
        onCloseAutoFocus={focusReturn.onCloseAutoFocus}
        // Why: a focused level's tooltip is the top layer, so Radix hands it the first Escape and
        // the picker would take a second. The search is left to Radix, which waits out an IME.
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !(event.target instanceof HTMLInputElement)) {
            setOpen(false)
          }
        }}
      >
        {model.kind.type === 'select' && !model.action ? (
          <NativeChatModelCombobox
            choices={model.kind.choices}
            currentValue={model.kind.currentValue}
            readOnly={!model.settable}
            readOnlyReason={modelReason}
            busy={busy}
            onSelect={(value) => set(model, value)}
          />
        ) : (
          <NativeChatSessionOptionWriteGroup busy={busy} className="flex flex-col p-1">
            {modelReason && !model.settable ? (
              <div className="px-2 py-1 text-xs text-muted-foreground">{modelReason}</div>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={!model.settable}
              className="w-full justify-start"
              onClick={() => act(model)}
            >
              {nativeChatSessionOptionActionLabel(model)}
            </Button>
          </NativeChatSessionOptionWriteGroup>
        )}
        <NativeChatSessionOptionRows
          options={options}
          shownReason={model.settable ? null : modelReason}
          busy={busy}
          onSet={set}
          onAction={act}
        />
      </PopoverContent>
    </Popover>
  )
}

function NativeChatSessionOptionPickersInner({
  surface,
  snapshot,
  isWorking,
  pickerRequest,
  focusComposer
}: NativeChatSessionOptionPickersProps): React.JSX.Element | null {
  const [pending, setPending] = useState<PendingPick | null>(null)
  const reportedModel = snapshot.find((descriptor) => descriptor.category === 'model')
  if (!surface || !reportedModel) {
    return null
  }
  const model = withPendingValue(reportedModel, pending)
  const options = sortNativeChatSessionOptions(snapshot).map((descriptor) =>
    withPendingValue(descriptor, pending)
  )

  const run = (pick: PendingPick, call: () => Promise<unknown>): void => {
    setPending(pick)
    void call()
      .catch((error) => {
        toast.error(
          translate(
            'components.native-chat.composer.optionUpdateFailed',
            'Could not update option'
          ),
          { description: optionUpdateFailureDescription(error) }
        )
      })
      .finally(() => setPending(null))
  }

  return (
    <div className="flex min-w-0 items-center text-chat-foreground-faint">
      <SessionOptionPopover
        key={pickerRequest?.sequence ?? 'idle'}
        model={model}
        options={options}
        isWorking={isWorking}
        busy={pending !== null}
        defaultOpen={Boolean(pickerRequest)}
        requestedOptionId={pickerRequest && pickerRequest.id !== model.id ? pickerRequest.id : null}
        onSet={(descriptor, value) =>
          run({ id: descriptor.id, value }, () => surface.setOption(descriptor.id, value))
        }
        onAction={(descriptor) =>
          run({ id: descriptor.id }, () => surface.invokeAction(descriptor.id))
        }
        focusComposer={focusComposer}
      />
    </div>
  )
}

export const NativeChatSessionOptionPickers = memo(NativeChatSessionOptionPickersInner)
