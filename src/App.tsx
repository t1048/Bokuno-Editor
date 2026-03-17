import { useState, useCallback, useEffect, useRef } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open, save, ask } from '@tauri-apps/plugin-dialog'
import Editor, { type EditorRef } from './components/Editor'
import SearchPanel from './components/SearchPanel'
import Icon from './components/Icon'
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

interface ReadRequest {
  file_path: string
  encoding?: string
}

interface WriteRequest {
  file_path: string
  content: string
  encoding?: string
  line_ending?: string
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
  const [encoding, setEncoding] = useState('utf-8')
  const [lineEnding, setLineEnding] = useState('CRLF')
  const [searchDirectory, setSearchDirectory] = useState('')
  const [showPathMenu, setShowPathMenu] = useState(false)
  const pathMenuRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorRef>(null)
  const tailUnlistenRef = useRef<(() => void) | null>(null)
  const isModifiedRef = useRef(isModified)

  // Sync isModifiedRef with isModified state for use in event listeners
  useEffect(() => {
    isModifiedRef.current = isModified
  }, [isModified])

  // Intercept window close request if there are unsaved changes
  useEffect(() => {
    if (!isTauri()) return

    const setupCloseHandler = async () => {
      const unlisten = await getCurrentWindow().onCloseRequested(async (event) => {
        if (isModifiedRef.current) {
          event.preventDefault()
          const confirmed = await ask(
            '変更が保存されていません。保存せずに終了しますか？',
            { title: 'Bokuno Editor', kind: 'warning', okLabel: 'はい', cancelLabel: 'いいえ' }
          )
          if (confirmed) {
            await getCurrentWindow().destroy()
          }
        }
      })
      return unlisten
    }

    const unlistenPromise = setupCloseHandler()
    return () => {
      unlistenPromise.then(unlisten => unlisten())
    }
  }, [])

  // パスメニュー外クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pathMenuRef.current && !pathMenuRef.current.contains(e.target as Node)) {
        setShowPathMenu(false)
      }
    }
    if (showPathMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showPathMenu])

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
      const readRequest: ReadRequest = { file_path: selected, encoding }
      const result = await invoke<FileContent>('read_file', { 
        request: readRequest 
      })
      setFileContent(result.content)
      setFileName(result.file_name)
      setFilePath(result.file_path)
      setIsModified(false)
      setSearchDirectory(getDirectoryFromPath(result.file_path))
      setStatusMessage(`Opened: ${result.file_name} (${encoding})`)
    } catch (error) {
      setStatusMessage(`Error: ${error}`)
    }
  }, [isTailMode, stopTail, encoding])

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

      const writeRequest: WriteRequest = { 
        file_path: targetPath, 
        content: fileContent,
        encoding,
        line_ending: lineEnding
      }
      await invoke('write_file', { 
        request: writeRequest 
      })
      setFilePath(targetPath)
      setFileName(targetName)
      setSearchDirectory(getDirectoryFromPath(targetPath))
      setIsModified(false)
      setStatusMessage(`Saved: ${targetName} (${encoding}, ${lineEnding})`)
    } catch (error) {
      setStatusMessage(`Error saving: ${error}`)
    }
  }, [filePath, fileName, fileContent, encoding, lineEnding])

  // Handle content change
  const handleContentChange = useCallback((content: string) => {
    setFileContent(content)
    setIsModified(true)
  }, [])

  // Handle reopen with current encoding
  const handleReopenWithEncoding = useCallback(async () => {
    if (!filePath) {
      setStatusMessage('No file open to reopen')
      return
    }

    if (isModified) {
      const confirmed = await ask(
        'You have unsaved changes. Reopening will discard your changes. Are you sure?',
        { title: 'Bokuno Editor', kind: 'warning' }
      )
      if (!confirmed) return
    }

    if (isTailMode) {
      await stopTail()
    }

    try {
      setStatusMessage(`Reopening with ${encoding}...`)
      const readRequest: ReadRequest = { file_path: filePath, encoding }
      const result = await invoke<FileContent>('read_file', { 
        request: readRequest 
      })
      setFileContent(result.content)
      setFileName(result.file_name)
      setFilePath(result.file_path)
      setIsModified(false)
      setStatusMessage(`Reopened: ${result.file_name} (${encoding})`)
    } catch (error) {
      setStatusMessage(`Error reopening: ${error}`)
    }
  }, [filePath, encoding, isModified, isTailMode, stopTail])

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
  const openSearchResult = useCallback(async (searchResult: SearchResult) => {
    if (isTailMode) {
      await stopTail()
    }

    try {
      const result = await invoke<FileContent>('read_file', { 
        request: { file_path: searchResult.file_path } 
      })
      setFileContent(result.content)
      setFileName(result.file_name)
      setFilePath(result.file_path)
      setIsModified(false)
      setSearchDirectory(getDirectoryFromPath(result.file_path))
      setShowSearch(false)
      setStatusMessage(`Opened: ${result.file_name} at line ${searchResult.line_number}`)
      setTimeout(() => editorRef.current?.scrollToLine(searchResult.line_number), 0)
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
          const result = await invoke<FileContent>('read_file', { 
            request: { file_path: filePath } 
          })
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
          const result = await invoke<FileContent>('read_file', { 
            request: { file_path: args.file_path } 
          })
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
          // Ctrl+Fで検索パネルを表示する機能は削除
          // Ctrl+T (Tail) ショートカットは削除
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleOpenFile, handleSaveFile])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // パスをクリップボードにコピー
  const handleCopyPath = useCallback(async () => {
    if (!filePath) return
    try {
      await navigator.clipboard.writeText(filePath)
      setStatusMessage('Path copied to clipboard')
      setShowPathMenu(false)
    } catch {
      setStatusMessage('Failed to copy path')
    }
  }, [filePath])

  // エクスプローラーで開く
  const handleOpenInExplorer = useCallback(async () => {
    if (!filePath) return
    try {
      await invoke('open_in_explorer', { filePath })
      setStatusMessage('Opened in Explorer')
      setShowPathMenu(false)
    } catch (error) {
      setStatusMessage(`Error: ${error}`)
    }
  }, [filePath])

  const statusTone = statusMessage.toLowerCase().includes('error') ? 'error' : 'ready'

  return (
    <div className="app" data-theme={theme}>
      <header className="toolbar">
        <div className="toolbar-row toolbar-actions-row">
          <div className="action-group" role="toolbar" aria-label="Editor actions">
            <button className="action-btn" onClick={handleOpenFile} title="Open File (Ctrl+O)" aria-label="Open File">
              <Icon name="open" />
            </button>
            <button
              className="action-btn"
              onClick={handleSaveFile}
              disabled={!isModified || isTailMode}
              title="Save (Ctrl+S)"
              aria-label="Save"
            >
              <Icon name="save" />
            </button>

            <div className="action-separator" />

            <button
              onClick={isTailMode ? stopTail : startTail}
              disabled={!filePath}
              title={isTailMode ? 'Stop Tail' : 'Start Tail - monitor file for new content'}
              aria-label={isTailMode ? 'Stop Tail' : 'Start Tail'}
              className={`action-btn ${isTailMode ? 'action-btn--active-tail' : ''}`}
            >
              <Icon name={isTailMode ? 'tail-stop' : 'tail-start'} />
            </button>
            <button
              onClick={() => setShowSearch(true)}
              title="Search (Ctrl+F)"
              aria-label="Search"
              className={`action-btn ${showSearch ? 'action-btn--active' : ''}`}
            >
              <Icon name="search" />
            </button>
          </div>

          <div className="toolbar-right">
            <button
              onClick={() => setShowSettings((prev) => !prev)}
              title="Settings"
              aria-label="Settings"
              className={`action-btn action-btn--settings ${showSettings ? 'action-btn--active' : ''}`}
            >
              <Icon name="settings" />
            </button>
          </div>
        </div>

        <div className="toolbar-row toolbar-doc-row">
          <div className="doc-info">
            <div className="doc-title-row">
              <Icon name="file" size={16} className="doc-icon" />
              <span className="doc-title">{fileName || 'Untitled'}</span>
              <span className={`doc-badge ${isModified ? 'doc-badge--warning' : 'doc-badge--neutral'}`}>
                {isModified ? 'Modified' : 'Saved'}
              </span>
              {isTailMode && <span className="doc-badge doc-badge--success">Live Tail</span>}
            </div>
            <div className="doc-path-row" ref={pathMenuRef}>
              <button
                className="doc-path-button"
                onClick={() => filePath && setShowPathMenu(prev => !prev)}
                disabled={!filePath}
                title={filePath || 'No file open'}
              >
                <span className="doc-path-text">{shortenPath(filePath)}</span>
                {filePath && (
                  <Icon name="chevron-down" size={12} className="doc-path-chevron" strokeWidth={2.5} />
                )}
              </button>
              {showPathMenu && (
                <div className="path-dropdown">
                  <button className="path-dropdown-item" onClick={handleCopyPath}>
                    <Icon name="copy" size={14} />
                    パスをコピー
                  </button>
                  <button className="path-dropdown-item" onClick={handleOpenInExplorer}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                    エクスプローラーで開く
                  </button>
                </div>
              )}
            </div>
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

              <div className="settings-section">
                <label htmlFor="encoding-select">Encoding</label>
                <select
                  id="encoding-select"
                  value={encoding}
                  onChange={(e) => setEncoding(e.target.value)}
                >
                  <option value="utf-8">UTF-8</option>
                  <option value="shift-jis">Shift-JIS</option>
                  <option value="utf-8-bom">UTF-8 (BOMあり)</option>
                </select>
                <button 
                  className="reopen-button" 
                  onClick={handleReopenWithEncoding}
                  disabled={!filePath}
                  title="Reopen file with selected encoding"
                >
                  Reopen
                </button>
              </div>

              <div className="settings-section">
                <label htmlFor="line-ending-select">Line Ending</label>
                <select
                  id="line-ending-select"
                  value={lineEnding}
                  onChange={(e) => setLineEnding(e.target.value)}
                >
                  <option value="LF">LF (Unix)</option>
                  <option value="CRLF">CRLF (Windows)</option>
                  <option value="CR">CR (Mac Legacy)</option>
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
          <span 
            className="status-pill clickable" 
            onClick={handleReopenWithEncoding}
            title="Click to reopen file with current encoding"
          >
            {encoding.toUpperCase()}
          </span>
          <span className="status-pill">{lineEnding}</span>
          <span className="status-pill">Font {fontSize}px</span>
        </div>
      </footer>
    </div>
  )
}

export default App
