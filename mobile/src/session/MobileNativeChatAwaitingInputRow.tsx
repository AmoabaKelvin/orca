import { StyleSheet, View } from 'react-native'
import { MessageSquareMore } from 'lucide-react-native'
import {
  NATIVE_CHAT_ASK_ROW_COPY,
  type NativeChatAskRowSubject
} from '../../../src/shared/native-chat-ask-row'
import { MobileSelectableText as Text } from '../components/MobileSelectableText'
import { INLINE_TEXT_SELECTION } from '../components/inline-text-selection'
import { colors, spacing, typography } from '../theme/mobile-theme'

/** The row a question draws in place of its raw tool call: the agent waits on the reader, so it
 *  says so and names what was asked. Desktop parity: `NativeChatAwaitingInputRow`. */
export function MobileNativeChatAwaitingInputRow({
  subject,
  pending
}: {
  /** Null when the call named no question; the label then reads alone. */
  subject: NativeChatAskRowSubject | null
  /** Still waiting on an answer; a settled prompt reports what was asked. */
  pending: boolean
}): React.JSX.Element {
  const label = !pending
    ? NATIVE_CHAT_ASK_ROW_COPY.asked
    : subject === null
      ? NATIVE_CHAT_ASK_ROW_COPY.awaitingUnnamed
      : NATIVE_CHAT_ASK_ROW_COPY.awaiting
  // A grouped prompt names its count: quoting its first question would read as the only one.
  const text =
    subject === null
      ? null
      : subject.kind === 'question'
        ? subject.text
        : NATIVE_CHAT_ASK_ROW_COPY.questionCount.replace(
            '{{value0}}',
            String(subject.questions.length)
          )
  return (
    <View style={styles.row} accessibilityLiveRegion={pending ? 'polite' : undefined}>
      <MessageSquareMore size={15} color={colors.textMuted} strokeWidth={2} style={styles.icon} />
      <Text selectable={INLINE_TEXT_SELECTION} style={styles.label}>
        {label}
        {text === null ? null : <Text style={styles.question}> {text}</Text>}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: 3
  },
  icon: {
    marginTop: 3
  },
  label: {
    flex: 1,
    color: colors.textMuted,
    fontSize: typography.bodySize,
    lineHeight: typography.bodySize + 6
  },
  question: {
    color: colors.textPrimary,
    fontSize: typography.bodySize,
    lineHeight: typography.bodySize + 6
  }
})
