import { StyleSheet, View } from 'react-native'
import { MessageSquareMore } from 'lucide-react-native'
import {
  NATIVE_CHAT_ASK_ROW_COPY,
  type NativeChatAskRowSubject
} from '../../../src/shared/native-chat-ask-row'
import { MobileSelectableText as Text } from '../components/MobileSelectableText'
import { INLINE_TEXT_SELECTION } from '../components/inline-text-selection'
import { colors, spacing, typography } from '../theme/mobile-theme'
import { scaledType } from './mobile-native-chat-message-styles'

const ICON_SIZE = 15

/** The row a question draws in place of its raw tool call: the agent waits on the reader, so it
 *  says so and names what was asked. Desktop parity: `NativeChatAwaitingInputRow`. */
export function MobileNativeChatAwaitingInputRow({
  subject,
  pending,
  fontScale = 1,
  listsQuestions = true
}: {
  /** Null when the call named no question; the label then reads alone. */
  subject: NativeChatAskRowSubject | null
  /** Still waiting on an answer; a settled prompt reports what was asked. */
  pending: boolean
  /** The chat's pinch zoom. */
  fontScale?: number
  /** False when the caller already shows each question of a grouped prompt in full. */
  listsQuestions?: boolean
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
  const type = scaledType(typography.bodySize, fontScale)
  // A group's line names only a count. While it waits, its card shows the questions; once nobody
  // can answer here, this row is the one place they still show, as desktop's list under the row.
  const questions =
    subject?.kind === 'questions' && listsQuestions && !pending ? subject.questions : null
  return (
    <>
      <View style={styles.row} accessibilityLiveRegion={pending ? 'polite' : undefined}>
        <MessageSquareMore
          size={ICON_SIZE * fontScale}
          color={colors.textMuted}
          strokeWidth={2}
          style={{ marginTop: 3 * fontScale }}
        />
        <Text selectable={INLINE_TEXT_SELECTION} style={[styles.label, type]}>
          {label}
          {text === null ? null : <Text style={[styles.question, type]}> {text}</Text>}
        </Text>
      </View>
      {questions === null ? null : (
        // Indented to the label, past the icon and its gap.
        <View style={{ paddingLeft: ICON_SIZE * fontScale + spacing.sm }}>
          {questions.map((question, index) => (
            <Text
              key={index}
              selectable={INLINE_TEXT_SELECTION}
              style={[styles.question, type]}
            >{`${index + 1}. ${question}`}</Text>
          ))}
        </View>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: 3
  },
  label: {
    flex: 1,
    color: colors.textMuted
  },
  question: {
    color: colors.textPrimary
  }
})
