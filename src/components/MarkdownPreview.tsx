import { useEffect, useRef, useMemo } from 'react'
import { marked } from 'marked'
import mermaid from 'mermaid'
import './MarkdownPreview.css'

interface MarkdownPreviewProps {
  content: string
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

// Mermaidコードブロックをプレースホルダに変換してから marked に渡す
const extractMermaidBlocks = (markdown: string): { processed: string; blocks: string[] } => {
  const blocks: string[] = []
  const processed = markdown.replace(/```mermaid\r?\n([\s\S]*?)```/g, (_, code) => {
    const index = blocks.length
    blocks.push(code.trim())
    return `<div class="mermaid-placeholder" data-index="${index}"></div>`
  })
  return { processed, blocks }
}

const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({ content, theme }) => {
  const containerRef = useRef<HTMLDivElement>(null)

  // Mermaidブロックを抽出してHTMLを生成
  const { html, mermaidBlocks } = useMemo(() => {
    const { processed, blocks } = extractMermaidBlocks(content)
    const rawHtml = marked.parse(processed, { async: false }) as string
    return { html: rawHtml, mermaidBlocks: blocks }
  }, [content])

  // DOMを更新してMermaidを描画
  useEffect(() => {
    if (!containerRef.current) return

    // Mermaid初期化（初回のみ）
    if (!mermaidInitialized) {
      initMermaid(theme)
    } else {
      // テーマ変更時は再初期化
      mermaid.initialize({
        startOnLoad: false,
        theme: theme === 'dark' ? 'dark' : 'default',
        securityLevel: 'loose',
      })
    }

    // プレースホルダをMermaid SVGに置き換える
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

  return (
    <div className={`markdown-preview ${theme === 'dark' ? 'markdown-preview--dark' : ''}`}>
      <div
        ref={containerRef}
        className="markdown-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}

export default MarkdownPreview
