import { useEffect, useRef, useMemo, useState, useCallback } from 'react'
import { marked } from 'marked'
import mermaid from 'mermaid'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import './MarkdownPreview.css'

interface MarkdownPreviewProps {
  content: string
  filePath?: string
  theme: 'light' | 'dark'
}

let mermaidInitialized = false

const initMermaid = (theme: 'light' | 'dark') => {
  mermaid.initialize({
    startOnLoad: false,
    theme: theme === 'dark' ? 'dark' : 'default',
    securityLevel: 'loose',
  })
  mermaidInitialized = true
}

const extractMermaidBlocks = (markdown: string): { processed: string; blocks: string[] } => {
  const blocks: string[] = []
  const processed = markdown.replace(/```mermaid\r?\n([\s\S]*?)```/g, (_, code) => {
    const index = blocks.length
    blocks.push(code.trim())
    return `<div class="mermaid-placeholder" data-index="${index}"></div>`
  })
  return { processed, blocks }
}

const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({ content, filePath, theme }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [streamedContent, setStreamedContent] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const offsetRef = useRef(0)
  const totalSizeRef = useRef(0)

  const effectiveContent = content || streamedContent

  const loadStreaming = useCallback(async (path: string) => {
    setIsLoading(true)
    try {
      const CHUNK_SIZE = 1024 * 512; // 512KB
      const chunk = await invoke<any>('read_file_chunk', {
        request: { file_path: path, start: 0, length: CHUNK_SIZE }
      })
      setStreamedContent(chunk.content)
      offsetRef.current = chunk.start + chunk.length
      totalSizeRef.current = chunk.total_size
    } catch (e) {
      console.error('Markdown streaming error:', e)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (filePath && content === '') {
      loadStreaming(filePath)
    } else {
      setStreamedContent('')
    }
  }, [content, filePath, loadStreaming])

  const { html, mermaidBlocks } = useMemo(() => {
    const { processed, blocks } = extractMermaidBlocks(effectiveContent)
    const rawHtml = marked.parse(processed, { async: false }) as string
    return { html: rawHtml, mermaidBlocks: blocks }
  }, [effectiveContent])

  useEffect(() => {
    if (!containerRef.current) return

    if (!mermaidInitialized) {
      initMermaid(theme)
    } else {
      mermaid.initialize({
        startOnLoad: false,
        theme: theme === 'dark' ? 'dark' : 'default',
        securityLevel: 'loose',
      })
    }

    const renderMermaid = async () => {
      const placeholders = containerRef.current?.querySelectorAll('.mermaid-placeholder')
      if (!placeholders) return

      for (const placeholder of Array.from(placeholders)) {
        const index = parseInt((placeholder as HTMLElement).dataset.index || '0', 10)
        const code = mermaidBlocks[index]
        if (code === undefined) continue

        try {
          const id = `mermaid-${Date.now()}-${index}`
          const { svg } = await mermaid.render(id, code)
          const wrapper = document.createElement('div')
          wrapper.className = 'mermaid-diagram'
          wrapper.innerHTML = svg
          placeholder.replaceWith(wrapper)
        } catch (err) {
          const errorDiv = document.createElement('div')
          errorDiv.className = 'mermaid-error'
          errorDiv.textContent = `Mermaid エラー: ${err}`
          placeholder.replaceWith(errorDiv)
        }
      }
    }

    renderMermaid()
  }, [html, mermaidBlocks, theme])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Add Ctrl+Click hint to all links
    const links = container.querySelectorAll('a[href]')
    links.forEach((link) => {
      if (!link.getAttribute('title')) {
        link.setAttribute('title', 'Ctrl+クリックでブラウザで開く')
      }
    })

    const handleLinkClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('a')
      if (!target) return
      const href = target.getAttribute('href')
      if (!href) return

      e.preventDefault()
      e.stopPropagation()

      if (e.ctrlKey || e.metaKey) {
        if (href.startsWith('http://') || href.startsWith('https://')) {
          openUrl(href).catch((err) => console.error('Failed to open URL:', err))
        } else {
          console.log('Ignored non-http/https URL for browser opening:', href)
        }
      }
    }

    container.addEventListener('click', handleLinkClick)
    return () => {
      container.removeEventListener('click', handleLinkClick)
    }
  }, [html])

  return (
    <div className={`markdown-preview ${theme === 'dark' ? 'markdown-preview--dark' : ''}`}>
      <div
        ref={containerRef}
        className="markdown-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {isLoading && <div className="markdown-loading">読み込み中...</div>}
    </div>
  )
}

export default MarkdownPreview
