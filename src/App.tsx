import { useState, useCallback, useEffect, useRef } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import Editor from './components/Editor'
import SearchPanel from './components/SearchPanel'
import './App.css'

interface FileContent {
  content: string
  file_name: string
  file_path: string
}

interface SearchResult {
  file_path: string
  line_number: number
  line_content: string
  matched_range: [number, number]
}

interface CliArgs {
  file_path: string | null
  search_directory: string | null
}

type Theme = 'light' | 'dark'

function App() {
  const [fileContent, setFileContent] = useState<string>('')
  const [fileName, setFileName] = useState<string>('')
  const [filePath, setFilePath] = useState<string>('')
  const [isModified, setIsModified] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [statusMessage, setStatusMessage] = useState('Ready')
  const [theme, setTheme] = useState<Theme>('light')
  const editorRef = useRef<{ getContent: () => string }>(null)
  const settingsMenuRef = useRef<HTMLDivElement>(null)

  // Handle file open
  const handleOpenFile = useCallback(async () => {
    try {
      // For now, use a simple prompt. In production, use Tauri's dialog API
      const path = prompt('Enter file path to open:')
      if (!path) return

      setStatusMessage('Loading...')
      const result = await invoke<FileContent>('read_file', { filePath: path })
      setFileContent(result.content)
      setFileName(result.file_name)
      setFilePath(result.file_path)
      setIsModified(false)
      setStatusMessage(`Opened: ${result.file_name}`)
    } catch (error) {
      setStatusMessage(`Error: ${error}`)
    }
  }, [])

  // Handle file save
  const handleSaveFile = useCallback(async () => {
    if (!filePath) {
      setStatusMessage('No file to save')
      return
    }

    try {
      const content = editorRef.current?.getContent() || fileContent
      await invoke('write_file', { filePath, content })
      setIsModified(false)
      setStatusMessage(`Saved: ${fileName}`)
    } catch (error) {
      setStatusMessage(`Error saving: ${error}`)
    }
  }, [filePath, fileName, fileContent])

  // Handle content change
  const handleContentChange = useCallback((_content: string) => {
    setIsModified(true)
  }, [])

  // Handle search
  const handleSearch = useCallback(async (directory: string, pattern: string, caseSensitive: boolean) => {
    setIsSearching(true)
    setStatusMessage('Searching...')
    
    try {
      const results = await invoke<SearchResult[]>('search_in_directory', {
        request: {
          directory,
          pattern,
          case_sensitive: caseSensitive,
        }
      })
      setSearchResults(results)
      setStatusMessage(`Found ${results.length} matches`)
    } catch (error) {
      setStatusMessage(`Search error: ${error}`)
    } finally {
      setIsSearching(false)
    }
  }, [])

  // Open file from search result
  const openSearchResult = useCallback(async (result: SearchResult) => {
    try {
      const fileData = await invoke<FileContent>('read_file', { filePath: result.file_path })
      setFileContent(fileData.content)
      setFileName(fileData.file_name)
      setFilePath(fileData.file_path)
      setIsModified(false)
      setStatusMessage(`Opened: ${fileData.file_name}`)
    } catch (error) {
      setStatusMessage(`Error opening file: ${error}`)
    }
  }, [])

  // Handle CLI args on startup
  useEffect(() => {
    const loadCliArgs = async () => {
      if (!isTauri()) {
        return
      }

      try {
        const args = await invoke<CliArgs>('get_cli_args')
        
        // If file path provided, open it
        if (args.file_path) {
          setStatusMessage('Loading...')
          const result = await invoke<FileContent>('read_file', { filePath: args.file_path })
          setFileContent(result.content)
          setFileName(result.file_name)
          setFilePath(result.file_path)
          setIsModified(false)
          setStatusMessage(`Opened: ${result.file_name}`)
        }
        
        // If search directory provided, open search panel with it
        if (args.search_directory) {
          setShowSearch(true)
        }
      } catch (error) {
        console.error('Failed to load CLI args:', error)
      }
    }
    
    loadCliArgs()
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'o':
            e.preventDefault()
            handleOpenFile()
            break
          case 's':
            e.preventDefault()
            handleSaveFile()
            break
          case 'f':
            e.preventDefault()
            setShowSearch(prev => !prev)
            break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleOpenFile, handleSaveFile])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    if (!showSettings) return

    const handleOutsideClick = (event: MouseEvent) => {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target as Node)) {
        setShowSettings(false)
      }
    }

    window.addEventListener('mousedown', handleOutsideClick)
    return () => window.removeEventListener('mousedown', handleOutsideClick)
  }, [showSettings])

  return (
    <div className="app" data-theme={theme}>
      <header className="toolbar">
        <div className="toolbar-left">
          <button onClick={handleOpenFile} title="Open File (Ctrl+O)">
            Open
          </button>
          <button onClick={handleSaveFile} disabled={!isModified} title="Save (Ctrl+S)">
            Save{isModified ? ' *' : ''}
          </button>
          <span className="file-name">
            {fileName || 'Untitled'}{isModified ? ' *' : ''}
          </span>
        </div>
        <div className="toolbar-right">
          <button onClick={() => setShowSearch(!showSearch)} title="Toggle Search (Ctrl+F)">
            Search
          </button>

          <div className="settings-container" ref={settingsMenuRef}>
            <button onClick={() => setShowSettings((prev) => !prev)} title="Settings">
              Settings
            </button>

            {showSettings && (
              <div className="settings-menu">
                <label htmlFor="theme-select">Theme</label>
                <select
                  id="theme-select"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value === 'dark' ? 'dark' : 'light')}
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                </select>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="main-content">
        <div className="editor-container">
          <Editor
            ref={editorRef}
            initialContent={fileContent}
            fileName={fileName}
            theme={theme}
            onChange={handleContentChange}
          />
        </div>

        {showSearch && (
          <SearchPanel
            results={searchResults}
            isSearching={isSearching}
            onSearch={handleSearch}
            onResultClick={openSearchResult}
            onClose={() => setShowSearch(false)}
          />
        )}
      </div>

      <footer className="status-bar">
        <span>{statusMessage}</span>
        <span className="shortcuts">
          Ctrl+O: Open | Ctrl+S: Save | Ctrl+F: Search
        </span>
      </footer>
    </div>
  )
}

export default App
