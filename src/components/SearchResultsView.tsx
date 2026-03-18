import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './SearchResultsView.css'

interface SearchResult {
  file_path: string
  line_number: number
  line_content: string
  matched_range: [number, number]
}

interface SearchResultsViewProps {
  directory: string
  pattern: string
  caseSensitive: boolean
  theme: string
}

const getRelativePath = (fullPath: string, dirPath: string) => {
  if (fullPath.startsWith(dirPath)) {
    return fullPath.slice(dirPath.length).replace(/^[/\\]/, '')
  }
  const parts = fullPath.split(/[/\\]/)
  return parts.slice(-3).join('/')
}

export default function SearchResultsView({ directory, pattern, caseSensitive, theme }: SearchResultsViewProps) {
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = `Search: ${pattern}`
  }, [pattern])

  useEffect(() => {
    let mounted = true
    const runSearch = async () => {
      try {
        setIsSearching(true)
        setError(null)
        const res = await invoke<SearchResult[]>('search_in_directory', {
          request: {
            directory,
            pattern,
            case_sensitive: caseSensitive,
          }
        })
        if (mounted) {
          setResults(res)
        }
      } catch (e) {
        if (mounted) {
          setError(String(e))
        }
      } finally {
        if (mounted) {
          setIsSearching(false)
        }
      }
    }
    runSearch()
    return () => { mounted = false }
  }, [directory, pattern, caseSensitive])

  const handleResultClick = useCallback(async (result: SearchResult) => {
    try {
      await invoke('open_file_in_new_window', {
        filePath: result.file_path,
        line: result.line_number
      })
    } catch (e) {
      console.error("Failed to open file:", e)
    }
  }, [])

  const highlightMatch = (line: string, range: [number, number]) => {
    const [start, end] = range
    const before = line.slice(0, start)
    const match = line.slice(start, end)
    const after = line.slice(end)
    
    return (
      <>
        {before}
        <mark className="search-highlight">{match}</mark>
        {after}
      </>
    )
  }

  return (
    <div className="search-results-view" data-theme={theme}>
      <header className="srv-header">
        <div className="srv-title">
          <h2>Search Results</h2>
          <div className="srv-meta">
            <span className="srv-pattern">"{pattern}"</span> in <span className="srv-dir">{directory}</span>
          </div>
        </div>
        <div className="srv-stats">
          {isSearching ? 'Searching...' : `${results.length} matches found`}
        </div>
      </header>

      <main className="srv-content">
        {error && <div className="srv-error">Error: {error}</div>}
        
        {!isSearching && results.length === 0 && !error && (
          <div className="srv-empty">No results found.</div>
        )}

        <div className="srv-list">
          {results.map((result, index) => (
            <div
              key={`${result.file_path}-${result.line_number}-${index}`}
              className="srv-item"
              onClick={() => handleResultClick(result)}
            >
              <div className="srv-item-header">
                <span className="srv-file">{getRelativePath(result.file_path, directory)}</span>
                <span className="srv-line-num">Line {result.line_number}</span>
              </div>
              <div className="srv-item-code">
                {highlightMatch(result.line_content, result.matched_range)}
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
