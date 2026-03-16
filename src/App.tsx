import { useState, useCallback, useEffect, useRef } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import Editor, { type EditorRef } from './components/Editor'
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
  const [isTailMode, setIsTailMode] = useState(false)
  const editorRef = useRef<EditorRef>(null)
  const settingsMenuRef = useRef<HTMLDivElement>(null)
  const tailUnlistenRef = useRef<(() => void) | null>(null)

  // Stop any active tail session and clean up listeners
  const stopTail = useCallback(async () => {
    if (isTauri()) {
      try {
        await invoke('stop_tail')
      } catch (error) {
        console.error('Failed to stop tail:', error)
      }
    }
    if (tailUnlistenRef.current) {
      tailUnlistenRef.current()
      tailUnlistenRef.current = null
    }
    setIsTailMode(false)
  }, [])

  // Handle file open
  const handleOpenFile = useCallback(async () => {
    if (isTailMode) {
      await stopTail()
    }

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
  }, [isTailMode, stopTail])

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

  // Start tail mode – watch the open file for new content
  const startTail = useCallback(async () => {
    if (!filePath) {
      setStatusMessage('No file open to tail')
      return
    }
    if (!isTauri()) {
      setStatusMessage('Tail requires running as a desktop app')
      return
    }

    try {
      await invoke('start_tail', { filePath })

      const unlistenUpdate = await listen<string>('tail_update', (event) => {
        editorRef.current?.appendContent(event.payload)
      })

      const unlistenRotated = await listen('tail_rotated', async () => {
        try {
          const result = await invoke<FileContent>('read_file', { filePath })
          setFileContent(result.content)
          setStatusMessage(`Tail: ${result.file_name} (rotated)`)
          // Scroll to bottom after React has re-rendered the new content
          setTimeout(() => editorRef.current?.scrollToBottom(), 0)
        } catch (error) {
          setStatusMessage(`Tail reload error: ${error}`)
        }
      })

      const unlistenError = await listen<string>('tail_error', (event) => {
        setStatusMessage(`Tail error: ${event.payload}`)
        setIsTailMode(false)
        tailUnlistenRef.current?.()
        tailUnlistenRef.current = null
      })

      tailUnlistenRef.current = () => {
        unlistenUpdate()
        unlistenRotated()
        unlistenError()
      }

      setIsTailMode(true)
      setStatusMessage(`Tailing: ${fileName}`)
    } catch (error) {
      setStatusMessage(`Failed to start tail: ${error}`)
    }
  }, [filePath, fileName])

  // Cleanup tail listeners on unmount
  useEffect(() => {
    return () => {
      tailUnlistenRef.current?.()
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
          case 't':
            e.preventDefault()
            if (isTailMode) {
              stopTail()
            } else {
              startTail()
            }
            break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleOpenFile, handleSaveFile, isTailMode, startTail, stopTail])

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
          <button onClick={handleSaveFile} disabled={!isModified || isTailMode} title="Save (Ctrl+S)">
            Save{isModified ? ' *' : ''}
          </button>
          <button
            onClick={isTailMode ? stopTail : startTail}
            disabled={!filePath}
            title={isTailMode ? 'Stop Tail (Ctrl+T)' : 'Start Tail – monitor file for new content (Ctrl+T)'}
            className={isTailMode ? 'btn-tail-active' : ''}
          >
            {isTailMode ? '⏹ Tail' : 'Tail'}
          </button>
          <span className="file-name">
            {fileName || 'Untitled'}{isModified && !isTailMode ? ' *' : ''}
            {isTailMode ? ' 👁' : ''}
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
            readOnly={isTailMode}
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
          Ctrl+O: Open | Ctrl+S: Save | Ctrl+F: Search | Ctrl+T: Tail
        </span>
      </footer>
    </div>
  )
}

export default App
