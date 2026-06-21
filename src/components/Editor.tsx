import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback, type MutableRefObject } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { keymap, Decoration, WidgetType, ViewPlugin } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import { EditorState, Compartment, Annotation } from '@codemirror/state'
import type { Text } from '@codemirror/state'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { findNext, findPrevious, openSearchPanel, searchKeymap } from '@codemirror/search'
import { oneDark } from '@codemirror/theme-one-dark'
import { javascript } from '@codemirror/lang-javascript'
import { rust } from '@codemirror/lang-rust'
import { python } from '@codemirror/lang-python'
import { markdown } from '@codemirror/lang-markdown'
import { cpp } from '@codemirror/lang-cpp'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { yaml } from '@codemirror/lang-yaml'
import { go } from '@codemirror/lang-go'
import { tags } from '@lezer/highlight'
import { invoke } from '@tauri-apps/api/core'
import './Editor.css'

const isInitialContent = Annotation.define<boolean>()

type LineEndingKind = 'CRLF' | 'LF' | 'CR'

const buildLineEndingMap = (content: string): LineEndingKind[] => {
  const map: LineEndingKind[] = []
  for (let i = 0; i < content.length; ) {
    while (i < content.length && content[i] !== '\n' && content[i] !== '\r') i++
    if (i >= content.length) break
    if (content[i] === '\r' && content[i + 1] === '\n') { map.push('CRLF'); i += 2 }
    else if (content[i] === '\r') { map.push('CR'); i += 1 }
    else { map.push('LF'); i += 1 }
  }
  return map
}

const countEOLsBefore = (doc: Text, pos: number): number => {
  let count = 0
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    if (line.to < doc.length && line.to < pos) count++
    else break
  }
  return count
}

const applyDocChangeToLineEndingMap = (
  map: LineEndingKind[],
  fromA: number,
  toA: number,
  inserted: string,
  docBefore: Text,
  defaultLE: LineEndingKind,
  pastedEOLs: LineEndingKind[] | null,
): LineEndingKind[] => {
  const result = [...map]

  let removeIdx = -1
  let removeCount = 0
  for (let n = 1; n <= docBefore.lines; n++) {
    const line = docBefore.line(n)
    if (line.to < docBefore.length && line.to >= fromA && line.to < toA) {
      if (removeIdx === -1) removeIdx = n - 1
      removeCount++
    }
  }

  if (removeCount === 0 && fromA < toA) {
    const startLine = docBefore.lineAt(fromA).number
    const endLine = docBefore.lineAt(Math.min(toA, docBefore.length - 1)).number
    if (endLine > startLine) {
      removeIdx = startLine - 1
      removeCount = 1
    }
  }

  const insertedEOLs: LineEndingKind[] = pastedEOLs?.length
    ? [...pastedEOLs]
    : Array((inserted.match(/\n/g) || []).length).fill(defaultLE)

  const insertIdx = removeIdx >= 0 ? removeIdx : countEOLsBefore(docBefore, fromA)

  if (removeCount > 0) {
    result.splice(insertIdx, removeCount, ...insertedEOLs)
  } else if (insertedEOLs.length > 0) {
    result.splice(insertIdx, 0, ...insertedEOLs)
  }

  return result
}

// Markdown 用カスタムハイライトスタイル（ライトテーマ）
const markdownHighlightStyleLight = HighlightStyle.define([
  // 見出し - 階層別に異なる色で視認性向上
  { tag: tags.heading1, color: '#0284c7', fontWeight: 'bold', backgroundColor: '#e0f2fe' },
  { tag: tags.heading2, color: '#0ea5e9', fontWeight: 'bold', backgroundColor: '#e0f2fe' },
  { tag: tags.heading3, color: '#38bdf8', fontWeight: 'bold', backgroundColor: '#f0f9ff' },
  { tag: tags.heading4, color: '#7dd3fc', fontWeight: 'bold', backgroundColor: '#f0f9ff' },
  { tag: tags.heading5, color: '#0369a1', fontWeight: 'bold' },
  { tag: tags.heading6, color: '#075985', fontWeight: 'bold' },
  
  // 太字 - 背景色を追加して目立たせる
  { tag: tags.strong, fontWeight: 'bold', color: '#1e293b', backgroundColor: '#f1f5f9' },
  
  // 斜体
  { tag: tags.emphasis, fontStyle: 'italic', color: '#475569' },
  
  // 取り消し線
  { tag: tags.strikethrough, textDecoration: 'line-through', color: '#94a3b8' },
  
  // インラインコード - 背景色と境界線を追加
  { tag: tags.monospace, backgroundColor: '#f1f5f9', color: '#059669', borderRadius: '4px' },
  
  // コードブロック - より明確な背景色
  { tag: tags.comment, color: '#047857', backgroundColor: '#ecfdf5' },
  
  // リンク - ホバーエフェクト強化のため色を強調
  { tag: tags.url, color: '#0284c7', textDecoration: 'underline', fontWeight: '500' },
  { tag: tags.link, color: '#0284c7', textDecoration: 'underline', fontWeight: '500' },
  
  // 引用 - 背景色を追加
  { tag: tags.quote, fontStyle: 'italic', color: '#78350f', backgroundColor: '#fef3c7' },
  
  // チェックボックス [ ] / [x]
  { tag: tags.atom, color: '#0284c7', fontWeight: '700' },
  
  // 水平線
  { tag: tags.contentSeparator, color: '#cbd5e1', fontWeight: 'bold' },
  
  // テーブル - セル境界線とヘッダー背景色
  { tag: tags.operator, color: '#64748b', fontWeight: '600' },
  { tag: tags.string, backgroundColor: '#f0fdf4', color: '#166534' },
])

// Markdown 用カスタムハイライトスタイル（ダークテーマ）
const markdownHighlightStyleDark = HighlightStyle.define([
  // 見出し - 階層別に異なる色で視認性向上
  { tag: tags.heading1, color: '#38bdf8', fontWeight: 'bold', backgroundColor: '#0c4a6e' },
  { tag: tags.heading2, color: '#7dd3fc', fontWeight: 'bold', backgroundColor: '#0c4a6e' },
  { tag: tags.heading3, color: '#bae6fd', fontWeight: 'bold', backgroundColor: '#164e63' },
  { tag: tags.heading4, color: '#e0f2fe', fontWeight: 'bold', backgroundColor: '#164e63' },
  { tag: tags.heading5, color: '#f0f9ff', fontWeight: 'bold' },
  { tag: tags.heading6, color: '#ffffff', fontWeight: 'bold' },
  
  // 太字 - 背景色を追加して目立たせる
  { tag: tags.strong, fontWeight: 'bold', color: '#f8fafc', backgroundColor: '#1e293b' },
  
  // 斜体
  { tag: tags.emphasis, fontStyle: 'italic', color: '#cbd5e1' },
  
  // 取り消し線
  { tag: tags.strikethrough, textDecoration: 'line-through', color: '#64748b', backgroundColor: '#450a0a' },
  
  // インラインコード - 背景色と境界線を追加
  { tag: tags.monospace, backgroundColor: '#1e293b', color: '#34d399', borderRadius: '4px' },
  
  // コードブロック - より明確な背景色
  { tag: tags.comment, color: '#6ee7b7', backgroundColor: '#064e3b' },
  
  // リンク - ホバーエフェクト強化のため色を強調
  { tag: tags.url, color: '#38bdf8', textDecoration: 'underline', fontWeight: '500' },
  { tag: tags.link, color: '#38bdf8', textDecoration: 'underline', fontWeight: '500' },
  
  // 引用 - 背景色を追加
  { tag: tags.quote, fontStyle: 'italic', color: '#fde68a', backgroundColor: '#422006' },
  
  // チェックボックス [ ] / [x]
  { tag: tags.atom, color: '#38bdf8', fontWeight: '700' },
  
  // 水平線
  { tag: tags.contentSeparator, color: '#475569', fontWeight: 'bold' },
  
  // テーブル - セル境界線とヘッダー背景色
  { tag: tags.operator, color: '#94a3b8', fontWeight: '600' },
  { tag: tags.string, backgroundColor: '#064e3b', color: '#6ee7b7' },
])

interface EditorProps {
  initialContent: string
  filePath?: string
  fileName: string
  theme: 'light' | 'dark'
  readOnly?: boolean
  fontSize?: number
  lineEnding?: string
  showLineEndingMarkers?: boolean
  initialLineEndingMap?: ('CRLF' | 'LF' | 'CR')[]
  onChange?: (content: string) => void
  onUserScrollAwayFromBottom?: () => void
}

export interface EditorRef {
  getContent: () => string
  appendContent: (text: string, autoScroll?: boolean) => void
  scrollToBottom: () => void
  scrollToLine: (lineNumber: number) => void
  setContent?: (text: string) => void
  setLineEnding?: (le: string) => void
  setLineEndingMap?: (map: ('CRLF' | 'LF' | 'CR')[]) => void
  openSearch?: () => void
  openReplace?: () => void
}

const getLanguageExtension = (fileName: string) => {
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
    case 'json':
      return javascript({ jsx: ext === 'jsx' || ext === 'tsx' })
    case 'rs':
      return rust()
    case 'py':
      return python()
    case 'md':
    case 'markdown':
      return markdown()
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'c':
    case 'h':
    case 'hpp':
    case 'hxx':
      return cpp()
    case 'html':
    case 'htm':
      return html()
    case 'css':
    case 'scss':
      return css()
    case 'yaml':
    case 'yml':
      return yaml()
    case 'go':
      return go()
    default:
      return []
  }
}

const Editor = forwardRef<EditorRef, EditorProps>(({ initialContent, filePath, fileName, theme, readOnly, fontSize = 14, lineEnding = 'CRLF', showLineEndingMarkers = false, initialLineEndingMap, onChange, onUserScrollAwayFromBottom }, ref) => {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const themeCompartmentRef = useRef(new Compartment())
  const readOnlyCompartmentRef = useRef(new Compartment())
  const fontSizeCompartmentRef = useRef(new Compartment())
  const languageCompartmentRef = useRef(new Compartment())
  const highlightCompartmentRef = useRef(new Compartment())
  // Decoration plugin for visible line ending markers
  const lineEndingPluginRef = useRef<any>(null)
  const lineEndingCompartmentRef = useRef(new Compartment())
  const lineEndingMapRef = useRef<LineEndingKind[]>([])
  const pendingPasteMapRef = useRef<LineEndingKind[] | null>(null)
  const lineEndingRef = useRef(lineEnding)

  useEffect(() => {
    lineEndingRef.current = lineEnding
  }, [lineEnding])

  const offsetRef = useRef(0)
  const totalSizeRef = useRef(0)
  const isStreamingRef = useRef(false)
  const shouldStreamRef = useRef(false)
  const ignoreNextScrollRef = useRef(false)
  const suppressManualScrollDetectUntilRef = useRef(0)
  const userScrollIntentUntilRef = useRef(0)
  const onUserScrollAwayFromBottomRef = useRef(onUserScrollAwayFromBottom)

  useEffect(() => {
    onUserScrollAwayFromBottomRef.current = onUserScrollAwayFromBottom
  }, [onUserScrollAwayFromBottom])

  // Widget that renders a visible line ending marker
  class LineEndingWidget extends WidgetType {
    readonly marker: string
    readonly className: string
    constructor(marker: string, className = '') {
      super()
      this.marker = marker
      this.className = className
    }
    toDOM() {
      const span = document.createElement('span')
      span.className = `cm-line-ending ${this.className}`
      span.textContent = this.marker
      span.title = 'Line ending: ' + this.marker
      return span
    }
    ignoreEvent() { return false }
  }

  const makeLineEndingPlugin = (
    mapRef: MutableRefObject<LineEndingKind[]>,
    pendingPasteRef: MutableRefObject<LineEndingKind[] | null>,
    getDefaultLE: () => string,
  ) => {
    return ViewPlugin.fromClass(class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = this.buildDeco(view)
      }
      update(update: any) {
        if (update.docChanged) {
          for (const tr of update.transactions) {
            if (tr.annotation(isInitialContent)) continue
            if (!tr.docChanged) continue
            tr.changes.iterChanges((fromA: number, toA: number, _fromB: number, _toB: number, inserted: any) => {
              mapRef.current = applyDocChangeToLineEndingMap(
                mapRef.current,
                fromA,
                toA,
                inserted.toString(),
                tr.startState.doc,
                getDefaultLE().toUpperCase() as LineEndingKind,
                pendingPasteRef.current,
              )
            })
          }
          pendingPasteRef.current = null
          this.decorations = this.buildDeco(update.view)
        } else if (update.viewportChanged) {
          this.decorations = this.buildDeco(update.view)
        }
      }
      buildDeco(view: EditorView) {
        const map = mapRef.current
        const defaultLE = getDefaultLE().toUpperCase()
        const builder: any[] = []
        for (const range of view.visibleRanges) {
          let pos = range.from
          while (pos <= range.to) {
            const line = view.state.doc.lineAt(pos)
            if (line.to < view.state.doc.length) {
              const kind = map[line.number - 1] ?? defaultLE
              const cls = `cm-line-ending--${kind.toLowerCase()}`
              const deco = Decoration.widget({ widget: new LineEndingWidget(kind, cls), side: 1 })
              builder.push(deco.range(line.to))
            }
            if (line.to >= range.to) break
            pos = line.to + 1
          }
        }
        return Decoration.set(builder)
      }
    }, { decorations: v => (v as any).decorations })
  }

  const loadNextChunk = useCallback(async () => {
    if (!shouldStreamRef.current) return
    if (!filePath || isStreamingRef.current) return
    if (totalSizeRef.current > 0 && offsetRef.current >= totalSizeRef.current) return

    isStreamingRef.current = true
    try {
      const CHUNK_SIZE = 1024 * 1024; // 1MB
      const chunk = await invoke<any>('read_file_chunk', {
        request: { file_path: filePath, start: offsetRef.current, length: CHUNK_SIZE }
      })
      
      const view = viewRef.current
      if (view) {
        view.dispatch({
          changes: { from: view.state.doc.length, insert: chunk.content },
          annotations: [isInitialContent.of(true)]
        })
      }
      
      offsetRef.current = chunk.start + chunk.length
      totalSizeRef.current = chunk.total_size
    } catch (e) {
      console.error('Text streaming error:', e)
    } finally {
      isStreamingRef.current = false
    }
  }, [filePath])

  const markUserScrollIntent = useCallback((durationMs = 1200) => {
    userScrollIntentUntilRef.current = Date.now() + durationMs
  }, [])

  useImperativeHandle(ref, () => ({
    getContent: () => {
      return viewRef.current?.state.doc.toString() || ''
    },
    setContent: (text: string) => {
      const view = viewRef.current
      if (!view) return
      const transaction = view.state.update({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      })
      view.dispatch(transaction)
    },
    appendContent: (text: string, autoScroll = true) => {
      const view = viewRef.current
      if (!view) return
      const endPos = view.state.doc.length
      view.dispatch({
        changes: { from: endPos, insert: text },
        effects: autoScroll ? EditorView.scrollIntoView(endPos + text.length, { y: 'end' }) : [],
      })
      if (autoScroll) {
        ignoreNextScrollRef.current = true
        suppressManualScrollDetectUntilRef.current = Date.now() + 800
        requestAnimationFrame(() => {
          ignoreNextScrollRef.current = false
        })
      }
    },
    scrollToBottom: () => {
      const view = viewRef.current
      if (!view) return
      ignoreNextScrollRef.current = true
      suppressManualScrollDetectUntilRef.current = Date.now() + 800
      view.dispatch({
        effects: EditorView.scrollIntoView(view.state.doc.length, { y: 'end' }),
      })
      requestAnimationFrame(() => {
        ignoreNextScrollRef.current = false
      })
    },
    scrollToLine: (lineNumber: number) => {
      const view = viewRef.current
      if (!view) return
      const safeLineNumber = Math.min(Math.max(lineNumber, 1), view.state.doc.lines)
      const line = view.state.doc.line(safeLineNumber)
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
      })
      view.focus()
    },
    setLineEnding: (le: string) => {
      const view = viewRef.current
      if (!view) return
      view.dispatch({
        effects: lineEndingCompartmentRef.current.reconfigure(
          showLineEndingMarkers ? makeLineEndingPlugin(lineEndingMapRef, pendingPasteMapRef, () => le || 'CRLF') : []
        ),
      })
    },
    setLineEndingMap: (map: ('CRLF' | 'LF' | 'CR')[]) => {
      lineEndingMapRef.current = map
      const view = viewRef.current
      if (view && showLineEndingMarkers) {
        view.dispatch({
          effects: lineEndingCompartmentRef.current.reconfigure(
            makeLineEndingPlugin(lineEndingMapRef, pendingPasteMapRef, () => lineEndingRef.current || 'CRLF')
          ),
        })
      }
    },
    openSearch: () => {
      const view = viewRef.current
      if (!view) return
      openSearchPanel(view)
      view.focus()
    },
    openReplace: () => {
      const view = viewRef.current
      if (!view) return
      openSearchPanel(view)
      view.focus()
    },
  }))

  useEffect(() => {
    if (!editorRef.current) return

    const lineEndingPlugin = makeLineEndingPlugin(
      lineEndingMapRef,
      pendingPasteMapRef,
      () => lineEndingRef.current || 'CRLF',
    )

    lineEndingPluginRef.current = lineEndingPlugin

    const state = EditorState.create({
      doc: initialContent,
      extensions: [
        basicSetup,
        keymap.of([
          ...searchKeymap,
          { key: 'F2', run: findNext },
          { key: 'Shift-F2', run: findPrevious },
        ]),
        themeCompartmentRef.current.of(theme === 'dark' ? oneDark : []),
        readOnlyCompartmentRef.current.of(EditorState.readOnly.of(readOnly ?? false)),
        fontSizeCompartmentRef.current.of(EditorView.theme({
          '&': {
            height: '100%',
            fontSize: `${fontSize}px`,
          },
          '.cm-scroller': {
            fontFamily: '"JetBrains Mono", "Fira Code", "Source Code Pro", Consolas, monospace',
          },
          '.cm-content': {
            padding: '14px 16px 24px',
          },
          '.cm-gutters': {
            borderRight: '1px solid transparent',
          },
        })),
        languageCompartmentRef.current.of(getLanguageExtension(fileName)),
        highlightCompartmentRef.current.of(
          syntaxHighlighting(theme === 'dark' ? markdownHighlightStyleDark : markdownHighlightStyleLight)
        ),
        // show line ending markers
        lineEndingCompartmentRef.current.of(showLineEndingMarkers ? lineEndingPlugin : []),
        EditorView.domEventHandlers({
          paste(event) {
            const text = event.clipboardData?.getData('text/plain')
            if (text) {
              pendingPasteMapRef.current = buildLineEndingMap(text)
            }
            return false
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && onChange && !update.transactions.some(tr => tr.annotation(isInitialContent))) {
            onChange(update.state.doc.toString())
          }

          // Check if we need to load more
          if (
            shouldStreamRef.current &&
            filePath &&
            update.view.scrollDOM.scrollTop + update.view.scrollDOM.clientHeight >= update.view.scrollDOM.scrollHeight - 1000
          ) {
            loadNextChunk()
          }
        }),
      ],
    })

    const view = new EditorView({
      state,
      parent: editorRef.current,
    })

    viewRef.current = view

    const handleWheel = () => {
      markUserScrollIntent()
    }
    const handlePointerDown = () => {
      markUserScrollIntent()
    }
    const handleTouchStart = () => {
      markUserScrollIntent()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      const scrollKeys = new Set([
        'ArrowUp',
        'ArrowDown',
        'PageUp',
        'PageDown',
        'Home',
        'End',
        ' '
      ])
      if (scrollKeys.has(event.key)) {
        markUserScrollIntent()
      }
    }

    const handleScroll = () => {
      if (!onUserScrollAwayFromBottomRef.current || ignoreNextScrollRef.current) return
      const now = Date.now()
      if (now < suppressManualScrollDetectUntilRef.current) return
      const scroller = view.scrollDOM
      const distanceFromBottom = scroller.scrollHeight - (scroller.scrollTop + scroller.clientHeight)
      const userIntentActive = now <= userScrollIntentUntilRef.current
      if (distanceFromBottom > 50 && userIntentActive) {
        onUserScrollAwayFromBottomRef.current()
      }
    }
    view.scrollDOM.addEventListener('wheel', handleWheel, { passive: true })
    view.scrollDOM.addEventListener('pointerdown', handlePointerDown, { passive: true })
    view.scrollDOM.addEventListener('touchstart', handleTouchStart, { passive: true })
    view.dom.addEventListener('keydown', handleKeyDown)
    view.scrollDOM.addEventListener('scroll', handleScroll, { passive: true })

    // If starting with empty content and have filePath, trigger first chunk
    shouldStreamRef.current = initialContent === '' && Boolean(filePath)
    if (shouldStreamRef.current) {
      offsetRef.current = 0
      totalSizeRef.current = 0
      loadNextChunk()
    }

    return () => {
      view.scrollDOM.removeEventListener('wheel', handleWheel)
      view.scrollDOM.removeEventListener('pointerdown', handlePointerDown)
      view.scrollDOM.removeEventListener('touchstart', handleTouchStart)
      view.dom.removeEventListener('keydown', handleKeyDown)
      view.scrollDOM.removeEventListener('scroll', handleScroll)
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!viewRef.current) return

    viewRef.current.dispatch({
      effects: themeCompartmentRef.current.reconfigure(theme === 'dark' ? oneDark : []),
    })
    viewRef.current.dispatch({
      effects: highlightCompartmentRef.current.reconfigure(
        syntaxHighlighting(theme === 'dark' ? markdownHighlightStyleDark : markdownHighlightStyleLight)
      ),
    })
  }, [theme])

  useEffect(() => {
    if (!viewRef.current) return

    viewRef.current.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure(
        EditorState.readOnly.of(readOnly ?? false)
      ),
    })
  }, [readOnly])

  useEffect(() => {
    if (!viewRef.current) return

    viewRef.current.dispatch({
      effects: fontSizeCompartmentRef.current.reconfigure(EditorView.theme({
        '&': {
          height: '100%',
          fontSize: `${fontSize}px`,
        },
        '.cm-scroller': {
          fontFamily: '"JetBrains Mono", "Fira Code", "Source Code Pro", Consolas, monospace',
        },
        '.cm-content': {
          padding: '14px 16px 24px',
        },
        '.cm-gutters': {
          borderRight: '1px solid transparent',
        },
      })),
    })
  }, [fontSize])

  // Update line ending markers when lineEnding or visibility changes
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: lineEndingCompartmentRef.current.reconfigure(
        showLineEndingMarkers ? makeLineEndingPlugin(lineEndingMapRef, pendingPasteMapRef, () => lineEndingRef.current || 'CRLF') : []
      ),
    })
  }, [lineEnding, showLineEndingMarkers])

  // Update language when fileName changes (file opened)
  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      effects: languageCompartmentRef.current.reconfigure(getLanguageExtension(fileName)),
    })
  }, [fileName])

  useEffect(() => {
    lineEndingMapRef.current = initialLineEndingMap ?? []
  }, [filePath, initialLineEndingMap])

  // Update content when initialContent changes (file opened)
  useEffect(() => {
    if (viewRef.current && initialContent !== viewRef.current.state.doc.toString()) {
      shouldStreamRef.current = initialContent === '' && Boolean(filePath)

      const transaction = viewRef.current.state.update({
        changes: {
          from: 0,
          to: viewRef.current.state.doc.length,
          insert: initialContent,
        },
        annotations: [isInitialContent.of(true)],
      })
      viewRef.current.dispatch(transaction)
      
      // If it's a new file (empty but has path), reset streaming
      if (shouldStreamRef.current) {
        offsetRef.current = 0
        totalSizeRef.current = 0
        loadNextChunk()
      } else {
        offsetRef.current = 0
        totalSizeRef.current = 0
      }
    }
  }, [initialContent, filePath, loadNextChunk])

  return <div ref={editorRef} className="editor" />
})

Editor.displayName = 'Editor'

export default Editor
