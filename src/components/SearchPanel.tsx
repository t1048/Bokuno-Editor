import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import './SearchPanel.css'

interface SearchResult {
  file_path: string
  line_number: number
  line_content: string
  matched_range: [number, number]
}

interface SearchPanelProps {
  results: SearchResult[]
  isSearching: boolean
  onSearch: (directory: string, pattern: string, caseSensitive: boolean) => void
  onResultClick: (result: SearchResult) => void
  onClose: () => void
  initialDirectory?: string
  currentPath?: string
}

const getDirectoryFromPath = (fullPath: string) => {
  if (!fullPath) return ''
  return fullPath.replace(/[\\/][^\\/]*$/, '')
}

function SearchPanel({
  results,
  isSearching,
  onSearch,
  onResultClick,
  onClose,
  initialDirectory = '',
  currentPath = '',
}: SearchPanelProps) {
  const [directory, setDirectory] = useState(initialDirectory)
  const [pattern, setPattern] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const directoryInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDirectory(initialDirectory)
  }, [initialDirectory])

  useEffect(() => {
    directoryInputRef.current?.focus()
    directoryInputRef.current?.select()
  }, [])

  const handleSearch = useCallback(() => {
    if (!directory || !pattern) return
    onSearch(directory, pattern, caseSensitive)
  }, [directory, pattern, caseSensitive, onSearch])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }

    if (e.key === 'Enter') {
      handleSearch()
    }
  }

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

  const getRelativePath = (fullPath: string) => {
    const parts = fullPath.split(/[/\\]/)
    return parts.slice(-2).join('/')
  }

  const currentDirectory = useMemo(() => getDirectoryFromPath(currentPath), [currentPath])
  const resultSummary = isSearching
    ? 'Searching workspace...'
    : results.length > 0
      ? `${results.length} matches`
      : pattern
        ? 'No matches found'
        : 'Search across a directory'

  return (
    <div className="search-panel">
      <div className="search-header">
        <div>
          <div className="search-kicker">Workspace search</div>
          <h3>Find in files</h3>
        </div>
        <button className="close-btn" onClick={onClose} aria-label="Close search panel">Close</button>
      </div>

      <div className="search-form">
        <div className="input-group">
          <label>Directory:</label>
          <input
            ref={directoryInputRef}
            type="text"
            value={directory}
            onChange={(e) => setDirectory(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter directory path..."
          />
        </div>

        <div className="input-group">
          <label>Pattern:</label>
          <input
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter search pattern..."
          />
        </div>

        <div className="search-options">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
            />
            Case sensitive
          </label>

          <button
            type="button"
            className="ghost-btn"
            onClick={() => setDirectory(currentDirectory)}
            disabled={!currentDirectory}
          >
            Use current folder
          </button>
        </div>

        <button
          className="search-btn" 
          onClick={handleSearch}
          disabled={isSearching || !directory || !pattern}
        >
          {isSearching ? 'Searching...' : 'Run search'}
        </button>

        <div className="search-hint">Enter to search. Escape to close.</div>
      </div>

      <div className="search-results">
        <div className="results-header">
          <span>{resultSummary}</span>
          {directory && <span className="results-scope">{getRelativePath(directory)}</span>}
        </div>

        <div className="results-list">
          {results.map((result, index) => (
            <div
              key={`${result.file_path}-${result.line_number}-${index}`}
              className="result-item"
              onClick={() => onResultClick(result)}
            >
              <div className="result-file">
                {getRelativePath(result.file_path)}:{result.line_number}
              </div>
              <div className="result-line">
                {highlightMatch(result.line_content, result.matched_range)}
              </div>
            </div>
          ))}
        </div>

        {results.length === 0 && !isSearching && (
          <div className="no-results">
            {pattern ? 'No matches found for the current pattern.' : 'Pick a directory and search term to explore your files.'}
          </div>
        )}
      </div>
    </div>
  )
}

export default SearchPanel
