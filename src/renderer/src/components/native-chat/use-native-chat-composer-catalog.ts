import { useMemo } from 'react'
import type { AgentType } from '../../../../shared/agent-status-types'
import {
  getNativeChatAgentProfile,
  getVerifiedNativeChatCommands
} from '../../../../shared/native-chat-agent-profiles'
import {
  sessionReportedSkillNames,
  sessionSlashCommandSuggestions,
  type SlashCommandSuggestion
} from '../../../../shared/native-chat-slash-commands'
import { structuredSlashCommands } from '../../../../shared/structured-agent-session-composer'
import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'

export type NativeChatComposerCatalog = {
  agentCommands: readonly SlashCommandSuggestion[]
  sessionSkillNames: readonly string[] | undefined
}

/**
 * What the `/` menu offers. A structured session reports the surface it actually
 * loaded — the only list that includes this repo's own commands and the skills
 * that reach the session through plugin roots — so it wins whenever it is
 * present. The curated per-agent catalog remains the answer for the PTY lane and
 * for a host that predates the report.
 */
export function useNativeChatComposerCatalog(
  agent: AgentType,
  structuredTransport?: NativeChatStructuredComposerTransport
): NativeChatComposerCatalog {
  const structured = Boolean(structuredTransport)
  const reported = structuredTransport?.sessionCommands
  const conversationCommands = structuredTransport?.conversationCommands
  const keepsScannedSkills = getNativeChatAgentProfile(agent)?.keepsScannedSkills === true
  const agentCommands = useMemo(() => {
    if (!structured) {
      return getVerifiedNativeChatCommands(agent)
    }
    if (reported === undefined) {
      return structuredSlashCommands(conversationCommands, agent)
    }
    const commands = sessionSlashCommandSuggestions(agent, reported)
    // The report cannot say which of its names are skills; a scanned one shows as the skill.
    return keepsScannedSkills
      ? commands.map((command) => ({ ...command, kindUnspecified: true as const }))
      : commands
  }, [agent, conversationCommands, keepsScannedSkills, reported, structured])
  const sessionSkillNames = useMemo(
    () =>
      reported !== undefined && !keepsScannedSkills
        ? sessionReportedSkillNames(reported)
        : undefined,
    [keepsScannedSkills, reported]
  )
  return { agentCommands, sessionSkillNames }
}
