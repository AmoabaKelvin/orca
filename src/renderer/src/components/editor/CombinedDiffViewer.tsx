import React, { useState, useEffect, useCallback, useRef } from 'react'
import { LazySection } from './LazySection'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { DiffEditor, type DiffOnMount } from '@monaco-editor/react'
import type { editor as monacoEditor } from 'monaco-editor'
import { useAppStore } from '@/store'
import { basename, dirname, joinPath } from '@/lib/path'
import { detectLanguage } from '@/lib/language-detect'
import '@/lib/monaco-setup'
import { cn } from '@/lib/utils'
import type { OpenFile } from '@/store/slices/editor'
import type { GitDiffResult, GitStatusEntry } from '../../../../shared/types'

type DiffSection = {
  key: string
  path: string
  status: string
  area?: GitStatusEntry['area']
  oldPath?: string
  originalContent: string
  modifiedContent: string
  collapsed: boolean
  loading: boolean
  dirty: boolean
  diffResult: GitDiffResult | null
}

export default function CombinedDiffViewer({ file }: { file: OpenFile }): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const gitStatusByWorktree = useAppStore((s) => s.gitStatusByWorktree)
  const gitBranchChangesByWorktree = useAppStore((s) => s.gitBranchChangesByWorktree)
  const gitBranchCompareSummaryByWorktree = useAppStore((s) => s.gitBranchCompareSummaryByWorktree)
  const openAllDiffs = useAppStore((s) => s.openAllDiffs)
  const openBranchAllDiffs = useAppStore((s) => s.openBranchAllDiffs)
  const isDark =
    settings?.theme === 'dark' ||
    (settings?.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  const [sections, setSections] = useState<DiffSection[]>([])
  const [sideBySide, setSideBySide] = useState(true)
  const [sectionHeights, setSectionHeights] = useState<Record<number, number>>({})

  const branchCompare =
    file.branchCompare?.baseOid && file.branchCompare.headOid && file.branchCompare.mergeBase
      ? file.branchCompare
      : null
  const branchSummary = gitBranchCompareSummaryByWorktree[file.worktreeId]
  const isBranchMode = file.diffSource === 'combined-branch'
  const uncommittedEntries = React.useMemo(
    () =>
      (gitStatusByWorktree[file.worktreeId] ?? []).filter((entry) => {
        if (file.combinedAreaFilter) {
          return entry.area === file.combinedAreaFilter
        }
        return entry.area !== 'untracked'
      }),
    [file.worktreeId, file.combinedAreaFilter, gitStatusByWorktree]
  )
  const branchEntries = React.useMemo(
    () => gitBranchChangesByWorktree[file.worktreeId] ?? [],
    [file.worktreeId, gitBranchChangesByWorktree]
  )

  // Initialize sections from entries without loading diff content
  useEffect(() => {
    const entries = isBranchMode ? branchEntries : uncommittedEntries
    setSections(
      entries.map((entry) => ({
        key: `${'area' in entry ? entry.area : 'branch'}:${entry.path}`,
        path: entry.path,
        status: entry.status,
        area: 'area' in entry ? entry.area : undefined,
        oldPath: entry.oldPath,
        originalContent: '',
        modifiedContent: '',
        collapsed: false,
        loading: true,
        dirty: false,
        diffResult: null
      }))
    )
    setSectionHeights({})
    loadedIndicesRef.current.clear()
    generationRef.current += 1
  }, [branchEntries, isBranchMode, uncommittedEntries])

  // Progressive loading: load diff content when a section becomes visible
  const loadedIndicesRef = useRef<Set<number>>(new Set())
  const generationRef = useRef(0)
  const loadSection = useCallback(
    async (index: number) => {
      if (loadedIndicesRef.current.has(index)) {
        return
      }
      loadedIndicesRef.current.add(index)

      const gen = generationRef.current
      const entries = isBranchMode ? branchEntries : uncommittedEntries
      const entry = entries[index]
      if (!entry) {
        return
      }

      let result: GitDiffResult
      try {
        result =
          isBranchMode && branchCompare
            ? ((await window.api.git.branchDiff({
                worktreePath: file.filePath,
                compare: {
                  baseRef: branchCompare.baseRef,
                  baseOid: branchCompare.baseOid!,
                  headOid: branchCompare.headOid!,
                  mergeBase: branchCompare.mergeBase!
                },
                filePath: entry.path,
                oldPath: entry.oldPath
              })) as GitDiffResult)
            : ((await window.api.git.diff({
                worktreePath: file.filePath,
                filePath: entry.path,
                staged: 'area' in entry && entry.area === 'staged'
              })) as GitDiffResult)
      } catch {
        result = {
          kind: 'text',
          originalContent: '',
          modifiedContent: '',
          originalIsBinary: false,
          modifiedIsBinary: false
        } as GitDiffResult
      }

      setSections((prev) => {
        if (generationRef.current !== gen) {
          return prev
        }
        return prev.map((s, i) =>
          i === index
            ? {
                ...s,
                diffResult: result,
                originalContent: result.kind === 'text' ? result.originalContent : '',
                modifiedContent: result.kind === 'text' ? result.modifiedContent : '',
                loading: false
              }
            : s
        )
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      branchCompare?.baseOid,
      branchCompare?.headOid,
      branchCompare?.mergeBase,
      branchEntries,
      file.filePath,
      isBranchMode,
      uncommittedEntries
    ]
  )

  const modifiedEditorsRef = useRef<Map<number, monacoEditor.IStandaloneCodeEditor>>(new Map())

  const toggleSection = useCallback((index: number) => {
    setSections((prev) => prev.map((s, i) => (i === index ? { ...s, collapsed: !s.collapsed } : s)))
  }, [])

  const handleSectionSave = useCallback(
    async (index: number) => {
      const section = sections[index]
      if (!section) {
        return
      }
      const modifiedEditor = modifiedEditorsRef.current.get(index)
      if (!modifiedEditor) {
        return
      }

      const content = modifiedEditor.getValue()
      const absolutePath = joinPath(file.filePath, section.path)
      try {
        await window.api.fs.writeFile({ filePath: absolutePath, content })
        setSections((prev) =>
          prev.map((s, i) => (i === index ? { ...s, modifiedContent: content, dirty: false } : s))
        )
      } catch (err) {
        console.error('Save failed:', err)
      }
    },
    [file.filePath, sections]
  )

  const handleSectionSaveRef = useRef(handleSectionSave)
  handleSectionSaveRef.current = handleSectionSave

  const openAlternateDiff = useCallback(() => {
    if (!file.combinedAlternate) {
      return
    }

    if (file.combinedAlternate.source === 'combined-uncommitted') {
      openAllDiffs(file.worktreeId, file.filePath)
      return
    }

    if (branchSummary && branchSummary.status === 'ready') {
      openBranchAllDiffs(file.worktreeId, file.filePath, branchSummary, {
        source: 'combined-uncommitted'
      })
    }
  }, [branchSummary, file, openAllDiffs, openBranchAllDiffs])

  if (sections.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No changes to display
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-background/50 shrink-0">
        <span className="text-xs text-muted-foreground">
          {sections.length} changed files
          {isBranchMode && branchCompare ? ` vs ${branchCompare.baseRef}` : ''}
        </span>
        <div className="flex items-center gap-2">
          {file.combinedAlternate && (
            <button
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={openAlternateDiff}
            >
              {file.combinedAlternate.source === 'combined-branch'
                ? 'Open Branch Diff'
                : 'Open Uncommitted Diff'}
            </button>
          )}
          <button
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setSections((prev) => prev.map((s) => ({ ...s, collapsed: true })))}
          >
            Collapse All
          </button>
          <button
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setSections((prev) => prev.map((s) => ({ ...s, collapsed: false })))}
          >
            Expand All
          </button>
          <button
            className="px-2 py-0.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setSideBySide((prev) => !prev)}
          >
            {sideBySide ? 'Inline' : 'Side by Side'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto scrollbar-editor">
        {sections.map((section, index) => {
          const language = detectLanguage(section.path)
          const fileName = basename(section.path)
          const parentDir = dirname(section.path)
          const dirPath = parentDir === '.' ? '' : parentDir
          const isEditable = section.area === 'unstaged'

          const handleMount: DiffOnMount = (editor, monaco) => {
            const modifiedEditor = editor.getModifiedEditor()

            // Track content size to dynamically resize the container
            const updateHeight = (): void => {
              const contentHeight = editor.getModifiedEditor().getContentHeight()
              setSectionHeights((prev) => {
                if (prev[index] === contentHeight) {
                  return prev
                }
                return { ...prev, [index]: contentHeight }
              })
            }
            modifiedEditor.onDidContentSizeChange(updateHeight)
            updateHeight()

            if (!isEditable) {
              return
            }

            modifiedEditorsRef.current.set(index, modifiedEditor)
            modifiedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
              handleSectionSaveRef.current(index)
            )
            modifiedEditor.onDidChangeModelContent(() => {
              const current = modifiedEditor.getValue()
              setSections((prev) =>
                prev.map((s, i) =>
                  i === index ? { ...s, dirty: current !== s.modifiedContent } : s
                )
              )
            })
          }

          return (
            <LazySection key={section.key} index={index} onVisible={loadSection}>
              <button
                className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm hover:bg-accent/30 transition-colors"
                onClick={() => toggleSection(index)}
              >
                {section.collapsed ? (
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="font-medium">
                  {fileName}
                  {section.dirty && <span className="text-muted-foreground ml-1">M</span>}
                </span>
                {dirPath && <span className="text-muted-foreground text-xs">{dirPath}</span>}
                <span
                  className={cn(
                    'text-xs font-bold ml-auto',
                    section.status === 'modified' && 'text-amber-500',
                    section.status === 'added' && 'text-green-500',
                    section.status === 'deleted' && 'text-red-500'
                  )}
                >
                  {section.area === 'staged'
                    ? 'Staged'
                    : section.area === 'unstaged'
                      ? 'Modified'
                      : isBranchMode
                        ? 'Branch'
                        : ''}
                </span>
              </button>

              {!section.collapsed && (
                <div
                  style={{
                    height: sectionHeights[index]
                      ? sectionHeights[index] + 19
                      : Math.max(
                          60,
                          Math.max(
                            section.originalContent.split('\n').length,
                            section.modifiedContent.split('\n').length
                          ) *
                            19 +
                            19
                        )
                  }}
                >
                  {section.loading ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
                      Loading...
                    </div>
                  ) : section.diffResult?.kind === 'binary' ? (
                    <div className="flex h-full items-center justify-center px-6 text-center">
                      <div className="space-y-2">
                        <div className="text-sm font-medium text-foreground">
                          Binary file changed
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {isBranchMode
                            ? 'Text diff is unavailable for this file in branch compare.'
                            : 'Text diff is unavailable for this file.'}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <DiffEditor
                      height="100%"
                      language={language}
                      original={section.originalContent}
                      modified={section.modifiedContent}
                      theme={isDark ? 'vs-dark' : 'vs'}
                      onMount={handleMount}
                      options={{
                        readOnly: !isEditable,
                        originalEditable: false,
                        renderSideBySide: sideBySide,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        fontSize: settings?.terminalFontSize ?? 13,
                        fontFamily: settings?.terminalFontFamily || 'monospace',
                        lineNumbers: 'on',
                        automaticLayout: true,
                        renderOverviewRuler: false,
                        scrollbar: { vertical: 'hidden', handleMouseWheel: false },
                        hideUnchangedRegions: { enabled: true }
                      }}
                    />
                  )}
                </div>
              )}
            </LazySection>
          )
        })}
      </div>
    </div>
  )
}
