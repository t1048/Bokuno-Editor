import { useState, useCallback, useEffect, useRef } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open, save } from '@tauri-apps/plugin-dialog'
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

const shortenPath = (fullPath: string) => {
  if (!fullPath) return 'No file open'

  const normalized = fullPath.replace(/\\/g, '/')
  const parts = normalized.split('/')

  if (parts.length <= 3) return normalized
  return `${parts.slice(0, 2).join('/')}/.../${parts.slice(-2).join('/')}`
}

const getDirectoryFromPath = (fullPath: string) => {
  if (!fullPath) return ''
  return fullPath.replace(/[\\/][^\\/]*$/, '')
}

const getFileNameFromPath = (fullPath: string) => {
  if (!fullPath) return ''
  const normalized = fullPath.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || ''
}

function App() {
    // フォントサイズの増減範囲
    const MIN_FONT_SIZE = 10;
    const MAX_FONT_SIZE = 32;
    // Ctrl+マウスホイールでフォントサイズ変更
    useEffect(() => {
      const handleWheel = (e: WheelEvent) => {
        if (e.ctrlKey) {
          e.preventDefault();
          setFontSize(prev => {
            let next = prev + (e.deltaY < 0 ? 1 : -1);
            if (next < MIN_FONT_SIZE) next = MIN_FONT_SIZE;
            if (next > MAX_FONT_SIZE) next = MAX_FONT_SIZE;
            return next;
          });
        }
      };
      window.addEventListener('wheel', handleWheel, { passive: false });
      return () => window.removeEventListener('wheel', handleWheel);
    }, []);
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
  const [fontSize, setFontSize] = useState(14)
  const [searchDirectory, setSearchDirectory] = useState('')
  const editorRef = useRef<EditorRef>(null)
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
      // ファイルダイアログを表示
      const selected = await open({ multiple: false, directory: false })
      if (!selected || typeof selected !== 'string') return

      setStatusMessage('Loading...')
      const result = await invoke<FileContent>('read_file', { filePath: selected })
      setFileContent(result.content)
      setFileName(result.file_name)
      setFilePath(result.file_path)
      setIsModified(false)
      setSearchDirectory(getDirectoryFromPath(result.file_path))
      setStatusMessage(`Opened: ${result.file_name}`)
    } catch (error) {
      setStatusMessage(`Error: ${error}`)
    }
  }, [isTailMode, stopTail])

  // Handle file save
  const handleSaveFile = useCallback(async () => {
    try {
      let targetPath = filePath
      let targetName = fileName

      if (!targetPath) {
        const selected = await save({
          defaultPath: targetName || 'untitled.txt',
        })
        if (!selected || typeof selected !== 'string') {
          setStatusMessage('Save canceled')
          return
        }
        targetPath = selected
        targetName = getFileNameFromPath(selected)
      }

      await invoke('write_file', { filePath: targetPath, content: fileContent })
      setFilePath(targetPath)
      setFileName(targetName)
      setSearchDirectory(getDirectoryFromPath(targetPath))
      setIsModified(false)
      setStatusMessage(`Saved: ${targetName}`)
    } catch (error) {
      setStatusMessage(`Error saving: ${error}`)
    }
  }, [filePath, fileName, fileContent])

  // Handle content change
  const handleContentChange = useCallback((content: string) => {
    setFileContent(content)
    setIsModified(true)
  }, [])

  // Handle search
  const handleSearch = useCallback(async (directory: string, pattern: string, caseSensitive: boolean) => {
    setIsSearching(true)
    setSearchDirectory(directory)
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
    if (isTailMode) {
      await stopTail()
    }

    try {
      const fileData = await invoke<FileContent>('read_file', { filePath: result.file_path })
      setFileContent(fileData.content)
      setFileName(fileData.file_name)
      setFilePath(fileData.file_path)
      setIsModified(false)
      setSearchDirectory(getDirectoryFromPath(fileData.file_path))
      setShowSearch(false)
      setStatusMessage(`Opened: ${fileData.file_name} at line ${result.line_number}`)
      setTimeout(() => editorRef.current?.scrollToLine(result.line_number), 0)
    } catch (error) {
      setStatusMessage(`Error opening file: ${error}`)
    }
  }, [isTailMode, stopTail])

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
          setSearchDirectory(getDirectoryFromPath(result.file_path))
          setStatusMessage(`Opened: ${result.file_name}`)
        }
        
        // If search directory provided, open search panel with it
        if (args.search_directory) {
          setSearchDirectory(args.search_directory)
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

  const statusTone = statusMessage.toLowerCase().includes('error') ? 'error' : 'ready'

  return (
    <div className="app" data-theme={theme}>
      <header className="toolbar">
        <div className="toolbar-primary">
          <div className="document-summary">
            <div className="document-title-row">
              <span className="document-title">{fileName || 'Untitled'}</span>
              <span className={`document-badge ${isModified ? 'warning' : 'neutral'}`}>
                {isModified ? 'Modified' : 'Saved'}
              </span>
              {isTailMode && <span className="document-badge success">Live Tail</span>}
            </div>
            <div className="document-path" title={filePath || 'No file open'}>
              {shortenPath(filePath)}
            </div>
          </div>

          <div className="tab-list" role="tablist" aria-label="Editor actions">
            <button className="tab-button" onClick={handleOpenFile} title="Open File (Ctrl+O)">
              Open
            </button>
            <button
              className="tab-button"
              onClick={handleSaveFile}
              disabled={!isModified || isTailMode}
              title="Save (Ctrl+S)"
            >
              Save
            </button>
            <button
              onClick={isTailMode ? stopTail : startTail}
              disabled={!filePath}
              title={isTailMode ? 'Stop Tail (Ctrl+T)' : 'Start Tail - monitor file for new content (Ctrl+T)'}
              className={`tab-button ${isTailMode ? 'btn-tail-active is-active' : ''}`}
            >
              {isTailMode ? 'Stop Tail' : 'Tail'}
            </button>
            <button
              onClick={() => setShowSearch(!showSearch)}
              title="Toggle Search (Ctrl+F)"
              className={`tab-button ${showSearch ? 'is-active' : ''}`}
            >
              Search
            </button>
          </div>
        </div>

        <div className="toolbar-actions">
          <div className="settings-container">
            <button
              onClick={() => setShowSettings((prev) => !prev)}
              title="Settings"
              aria-label="Settings"
              className={`icon-button settings-button ${showSettings ? 'is-active' : ''}`}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
                <path
                  d="M12 2a1 1 0 0 1 1 1v1.08a7.5 7.5 0 0 1 4.41 2.41l.76-.44a1 1 0 0 1 1.27.25l.7.7a1 1 0 0 1 .23 1.12l-.46.88A7.5 7.5 0 0 1 21 12c0 .36-.04.72-.11 1.07l.46.88a1 1 0 0 1-.23 1.12l-.7.7a1 1 0 0 1-1.12.25l-.76-.44A7.5 7.5 0 0 1 13 19.92V21a1 1 0 0 1-2 0v-1.08a7.5 7.5 0 0 1-4.41-2.41l-.76.44a1 1 0 0 1-1.27-.25l-.7-.7a1 1 0 0 1-.23-1.12l.46-.88A7.5 7.5 0 0 1 3 12c0-.36.04-.72.11-1.07l-.46-.88a1 1 0 0 1 .23-1.12l.7-.7a1 1 0 0 1 1.12-.25l.76.44A7.5 7.5 0 0 1 11 4.08V3a1 1 0 0 1 1-1zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div className="main-content">
        <section className="workspace-main">
          <div className="editor-frame">
            <Editor
              ref={editorRef}
              initialContent={fileContent}
              fileName={fileName}
              theme={theme}
              readOnly={isTailMode}
              fontSize={fontSize}
              onChange={handleContentChange}
            />
          </div>
        </section>

        {showSettings && (
          <aside className="settings-panel" aria-label="Settings">
            <div className="settings-panel-header">
              <div>
                <div className="settings-panel-kicker">Preferences</div>
                <h3>Settings</h3>
              </div>
              <button
                className="settings-close-btn"
                onClick={() => setShowSettings(false)}
                aria-label="Close settings panel"
              >
                Close
              </button>
            </div>

            <div className="settings-panel-body">
              <div className="settings-section">
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

              <div className="settings-section">
                <label htmlFor="font-size-select">Editor font size</label>
                <select
                  id="font-size-select"
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                >
                  <option value={13}>13 px</option>
                  <option value={14}>14 px</option>
                  <option value={16}>16 px</option>
                  <option value={18}>18 px</option>
                </select>
              </div>

              <div className="settings-note">
                Search uses Enter to run and Escape to close.
              </div>
            </div>
          </aside>
        )}

        {showSearch && (
          <SearchPanel
            results={searchResults}
            isSearching={isSearching}
            onSearch={handleSearch}
            onResultClick={openSearchResult}
            onClose={() => setShowSearch(false)}
            initialDirectory={searchDirectory}
            currentPath={filePath}
          />
        )}
      </div>

      <footer className="status-bar">
        <div className="status-primary">
          <span className={`status-indicator ${statusTone}`} />
          <span>{statusMessage}</span>
        </div>

        <div className="status-secondary">
          <span className="status-pill">{isTailMode ? 'Read only' : 'Editable'}</span>
          <span className="status-pill">Font {fontSize}px</span>
          {/* <span className="status-pill shortcuts">Ctrl+O Open  Ctrl+S Save  Ctrl+F Search  Ctrl+T Tail</span> */}
        </div>
      </footer>
    </div>
  )
}

export default App
