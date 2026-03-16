import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, Compartment } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { javascript } from '@codemirror/lang-javascript'
import { rust } from '@codemirror/lang-rust'
import { python } from '@codemirror/lang-python'
import { markdown } from '@codemirror/lang-markdown'
import './Editor.css'

interface EditorProps {
  initialContent: string
  fileName: string
  theme: 'light' | 'dark'
  readOnly?: boolean
  onChange?: (content: string) => void
}

export interface EditorRef {
  getContent: () => string
  appendContent: (text: string) => void
  scrollToBottom: () => void
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
    default:
      return []
  }
}

const Editor = forwardRef<EditorRef, EditorProps>(({ initialContent, fileName, theme, readOnly, onChange }, ref) => {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const themeCompartmentRef = useRef(new Compartment())
  const readOnlyCompartmentRef = useRef(new Compartment())

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
  }))

  useEffect(() => {
    if (!editorRef.current) return

    const languageExtension = getLanguageExtension(fileName)

    const state = EditorState.create({
      doc: initialContent,
      extensions: [
        basicSetup,
        themeCompartmentRef.current.of(theme === 'dark' ? oneDark : []),
        readOnlyCompartmentRef.current.of(EditorState.readOnly.of(readOnly ?? false)),
        languageExtension,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && onChange) {
            onChange(update.state.doc.toString())
          }
        }),
        EditorView.theme({
          '&': {
            height: '100%',
            fontSize: '14px',
          },
          '.cm-scroller': {
            fontFamily: '"JetBrains Mono", "Fira Code", "Source Code Pro", Consolas, monospace',
          },
          '.cm-content': {
            padding: '10px',
          },
        }),
      ],
    })

    const view = new EditorView({
      state,
      parent: editorRef.current,
    })

    viewRef.current = view

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
  }, [theme])

  useEffect(() => {
    if (!viewRef.current) return

    viewRef.current.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure(
        EditorState.readOnly.of(readOnly ?? false)
      ),
    })
  }, [readOnly])

  // Update content when initialContent changes (file opened)
  useEffect(() => {
    if (viewRef.current && initialContent !== viewRef.current.state.doc.toString()) {
      const transaction = viewRef.current.state.update({
        changes: {
          from: 0,
          to: viewRef.current.state.doc.length,
          insert: initialContent,
        },
      })
      viewRef.current.dispatch(transaction)
    }
  }, [initialContent])

  return <div ref={editorRef} className="editor" />
})

Editor.displayName = 'Editor'

export default Editor
