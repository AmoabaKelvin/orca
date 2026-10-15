import { StyleSheet, View } from 'react-native'
import {
  NATIVE_CHAT_RECEIPT_COPY,
  nativeChatReceiptAnswerHeading,
  nativeChatReceiptAnswers,
  nativeChatReceiptSubject,
  type NativeChatResolvedPrompt
} from '../../../src/shared/native-chat-resolution-receipt'
import { MobileSelectableText as Text } from '../components/MobileSelectableText'
import { INLINE_TEXT_SELECTION } from '../components/inline-text-selection'
import { colors, spacing, typography } from '../theme/mobile-theme'
import { MobileNativeChatAwaitingInputRow } from './MobileNativeChatAwaitingInputRow'
import { scaledType } from './mobile-native-chat-message-styles'

/** What an approval or question left in the transcript once answered, and a question still
 *  waiting as its ask row. Desktop parity: `NativeChatResolutionReceipt`. */
export function MobileNativeChatResolutionReceipt({
  body,
  awaiting = true,
  fontScale = 1
}: {
  body: NativeChatResolvedPrompt
  /** False when the agent that asked has ended: the row reports what was asked, not waiting. */
  awaiting?: boolean
  /** The chat's pinch zoom. */
  fontScale?: number
}): React.JSX.Element | null {
  const subject = nativeChatReceiptSubject(body)
  if (body.resolution.state === 'pending') {
    return body.kind === 'question' ? (
      <MobileNativeChatAwaitingInputRow
        subject={subject}
        pending={awaiting}
        fontScale={fontScale}
      />
    ) : null
  }
  const { resolution } = body
  const answers = nativeChatReceiptAnswers(body)
  const outcome = [
    resolution.state === 'cancelled'
      ? NATIVE_CHAT_RECEIPT_COPY.cancelled
      : NATIVE_CHAT_RECEIPT_COPY.resolved,
    resolution.resolvedBy
      ? (resolution.state === 'cancelled'
          ? NATIVE_CHAT_RECEIPT_COPY.cancelledBy
          : NATIVE_CHAT_RECEIPT_COPY.resolver
        ).replace('{{device}}', resolution.resolvedBy)
      : null
  ]
  const text = [styles.text, scaledType(typography.metaSize, fontScale, 5)]
  return (
    <View style={styles.receipt}>
      {body.kind === 'question' ? (
        <MobileNativeChatAwaitingInputRow
          subject={subject}
          pending={false}
          fontScale={fontScale}
          // An answered group already shows each question above its answer.
          listsQuestions={answers.length === 0}
        />
      ) : (
        <Text selectable={INLINE_TEXT_SELECTION} style={[text, styles.title]}>
          {body.displayName ?? body.title}
        </Text>
      )}
      {body.kind === 'approval' && body.detail ? (
        <Text selectable={INLINE_TEXT_SELECTION} style={text} numberOfLines={3}>
          {body.detail}
        </Text>
      ) : null}
      {answers.map((answer, index) => {
        const heading = nativeChatReceiptAnswerHeading(body, answer)
        return (
          <View
            key={body.kind === 'question' ? (body.questions?.[index]?.id ?? 'answer') : 'answer'}
          >
            {heading ? <Text style={text}>{heading}</Text> : null}
            <Text selectable={INLINE_TEXT_SELECTION} style={text} numberOfLines={3}>
              {answer.answer === ''
                ? NATIVE_CHAT_RECEIPT_COPY.emptyAnswer
                : (answer.answer ?? NATIVE_CHAT_RECEIPT_COPY.unavailable)}
            </Text>
          </View>
        )
      })}
      <Text style={text}>{outcome.filter(Boolean).join(' · ')}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  receipt: {
    gap: spacing.xs,
    paddingLeft: spacing.md,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.borderSubtle
  },
  text: {
    color: colors.textMuted
  },
  title: {
    fontWeight: '600'
  }
})
