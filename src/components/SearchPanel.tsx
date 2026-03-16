import { useState, useCallback } from 'react'
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
}

function SearchPanel({ results, isSearching, onSearch, onResultClick, onClose }: SearchPanelProps) {
  const [directory, setDirectory] = useState('')
  const [pattern, setPattern] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)

  const handleSearch = useCallback(() => {
    if (!directory || !pattern) return
    onSearch(directory, pattern, caseSensitive)
  }, [directory, pattern, caseSensitive, onSearch])

  const handleKeyDown = (e: React.KeyboardEvent) => {
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

  return (
    <div className="search-panel">
      <div className="search-header">
        <h3>Search</h3>
        <button className="close-btn" onClick={onClose}>×</button>
      </div>

      <div className="search-form">
        <div className="input-group">
          <label>Directory:</label>
          <input
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
        </div>

        <button 
          className="search-btn" 
          onClick={handleSearch}
          disabled={isSearching || !directory || !pattern}
        >
          {isSearching ? 'Searching...' : 'Search'}
        </button>
      </div>

      <div className="search-results">
        {results.length > 0 && (
          <div className="results-header">
            {results.length} matches found
          </div>
        )}

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

        {results.length === 0 && !isSearching && pattern && (
          <div className="no-results">No matches found</div>
        )}
      </div>
    </div>
  )
}

export default SearchPanel
