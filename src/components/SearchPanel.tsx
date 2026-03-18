import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import './SearchPanel.css'

interface SearchPanelProps {
  onSearch: (directory: string, pattern: string, caseSensitive: boolean) => void
  onClose: () => void
  initialDirectory?: string
  currentPath?: string
}

const getDirectoryFromPath = (fullPath: string) => {
  if (!fullPath) return ''
  return fullPath.replace(/[\\/][^\\/]*$/, '')
}

function SearchPanel({
  onSearch,
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

  const currentDirectory = useMemo(() => getDirectoryFromPath(currentPath), [currentPath])

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
          disabled={!directory || !pattern}
        >
          Run search
        </button>

        <div className="search-hint">Enter to run search in a new window. Escape to close.</div>
      </div>
    </div>
  )
}

export default SearchPanel
