import { useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Compartment, Annotation } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { findNext, findPrevious } from '@codemirror/search'
import { oneDark } from '@codemirror/theme-one-dark'
import { javascript } from '@codemirror/lang-javascript'
import { rust } from '@codemirror/lang-rust'
import { python } from '@codemirror/lang-python'
import { markdown } from '@codemirror/lang-markdown'
import { cpp } from '@codemirror/lang-cpp'
import { tags } from '@lezer/highlight'
import { invoke } from '@tauri-apps/api/core'
import './Editor.css'

const isInitialContent = Annotation.define<boolean>()

// Markdown用カスタムハイライトスタイル（ライトテーマ）
const markdownHighlightStyleLight = HighlightStyle.define([
  // 見出し
  { tag: tags.heading1, color: '#e11d48', fontWeight: 'bold' },
  { tag: tags.heading2, color: '#d97706', fontWeight: 'bold' },
  { tag: tags.heading3, color: '#059669', fontWeight: 'bold' },
  { tag: tags.heading4, color: '#0284c7', fontWeight: 'bold' },
  { tag: tags.heading5, color: '#7c3aed', fontWeight: 'bold' },
  { tag: tags.heading6, color: '#64748b', fontWeight: 'bold' },
  
  // 太字
  { tag: tags.strong, fontWeight: 'bold', color: '#0f172a' },
  
  // 斜体
  { tag: tags.emphasis, fontStyle: 'italic', color: '#334155' },
  
  // 取り消し線
  { tag: tags.strikethrough, textDecoration: 'line-through', color: '#64748b' },
  
  // インラインコード
  { tag: tags.monospace, color: '#e11d48', backgroundColor: 'rgba(225, 24, 72, 0.08)', borderRadius: '3px' },
  
  // コードブロック
  { tag: tags.comment, color: '#059669' },
  
  // リンク
  { tag: tags.url, color: '#0ea5e9', textDecoration: 'underline' },
  { tag: tags.link, color: '#0ea5e9', textDecoration: 'underline' },
  
  // 引用
  { tag: tags.quote, color: '#64748b', fontStyle: 'italic', backgroundColor: 'rgba(100, 116, 139, 0.08)' },
  
  // リスト
  { tag: tags.list, color: '#0ea5e9', fontWeight: '600' },
  
  // 水平線
  { tag: tags.contentSeparator, color: '#94a3b8' },
  
  // テーブル
  { tag: tags.operator, color: '#64748b', fontWeight: '600' },
])

// Markdown用カスタムハイライトスタイル（ダークテーマ）
const markdownHighlightStyleDark = HighlightStyle.define([
  // 見出し
  { tag: tags.heading1, color: '#fb7185', fontWeight: 'bold' },
  { tag: tags.heading2, color: '#fbbf24', fontWeight: 'bold' },
  { tag: tags.heading3, color: '#34d399', fontWeight: 'bold' },
  { tag: tags.heading4, color: '#38bdf8', fontWeight: 'bold' },
  { tag: tags.heading5, color: '#a78bfa', fontWeight: 'bold' },
  { tag: tags.heading6, color: '#94a3b8', fontWeight: 'bold' },
  
  // 太字
  { tag: tags.strong, fontWeight: 'bold', color: '#f8fafc' },
  
  // 斜体
  { tag: tags.emphasis, fontStyle: 'italic', color: '#cbd5e1' },
  
  // 取り消し線
  { tag: tags.strikethrough, textDecoration: 'line-through', color: '#94a3b8' },
  
  // インラインコード
  { tag: tags.monospace, color: '#fb7185', backgroundColor: 'rgba(251, 113, 133, 0.12)', borderRadius: '3px' },
  
  // コードブロック
  { tag: tags.comment, color: '#34d399' },
  
  // リンク
  { tag: tags.url, color: '#38bdf8', textDecoration: 'underline' },
  { tag: tags.link, color: '#38bdf8', textDecoration: 'underline' },
  
  // 引用
  { tag: tags.quote, color: '#94a3b8', fontStyle: 'italic', backgroundColor: 'rgba(148, 163, 184, 0.12)' },
  
  // リスト
  { tag: tags.list, color: '#38bdf8', fontWeight: '600' },
  
  // 水平線
  { tag: tags.contentSeparator, color: '#64748b' },
  
  // テーブル
  { tag: tags.operator, color: '#94a3b8', fontWeight: '600' },
])

interface EditorProps {
  initialContent: string
  filePath?: string
  fileName: string
  theme: 'light' | 'dark'
  readOnly?: boolean
  fontSize?: number
  onChange?: (content: string) => void
}

export interface EditorRef {
  getContent: () => string
  appendContent: (text: string) => void
  scrollToBottom: () => void
  scrollToLine: (lineNumber: number) => void
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
    default:
      return []
  }
}

const Editor = forwardRef<EditorRef, EditorProps>(({ initialContent, filePath, fileName, theme, readOnly, fontSize = 14, onChange }, ref) => {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const themeCompartmentRef = useRef(new Compartment())
  const readOnlyCompartmentRef = useRef(new Compartment())
  const fontSizeCompartmentRef = useRef(new Compartment())
  const languageCompartmentRef = useRef(new Compartment())
  const highlightCompartmentRef = useRef(new Compartment())

  const offsetRef = useRef(0)
  const totalSizeRef = useRef(0)
  const isStreamingRef = useRef(false)
  const shouldStreamRef = useRef(false)

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

  useImperativeHandle(ref, () => ({
    getContent: () => {
      return viewRef.current?.state.doc.toString() || ''
    },
    appendContent: (text: string) => {
      const view = viewRef.current
      if (!view) return
      const endPos = view.state.doc.length
      view.dispatch({
        changes: { from: endPos, insert: text },
        effects: EditorView.scrollIntoView(endPos + text.length, { y: 'end' }),
      })
    },
    scrollToBottom: () => {
      const view = viewRef.current
      if (!view) return
      view.dispatch({
        effects: EditorView.scrollIntoView(view.state.doc.length, { y: 'end' }),
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
  }))

  useEffect(() => {
    if (!editorRef.current) return

    const state = EditorState.create({
      doc: initialContent,
      extensions: [
        basicSetup,
        keymap.of([
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

    // If starting with empty content and have filePath, trigger first chunk
    shouldStreamRef.current = initialContent === '' && Boolean(filePath)
    if (shouldStreamRef.current) {
      offsetRef.current = 0
      totalSizeRef.current = 0
      loadNextChunk()
    }

    return () => {
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

  // Update language when fileName changes (file opened)
  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      effects: languageCompartmentRef.current.reconfigure(getLanguageExtension(fileName)),
    })
  }, [fileName])

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
