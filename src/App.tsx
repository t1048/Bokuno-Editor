import { useState, useCallback, useEffect, useRef } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open, save, ask } from '@tauri-apps/plugin-dialog'
import Editor, { type EditorRef } from './components/Editor'
import MarkdownPreview from './components/MarkdownPreview'
import CsvEditor from './components/CsvEditor'
import SearchPanel from './components/SearchPanel'
import SearchResultsView from './components/SearchResultsView'
import FileTree from './components/FileTree'
import Icon from './components/Icon'
import './App.css'

interface FileContent {
  content: string
  file_name: string
  file_path: string
  encoding: string
}

interface CliArgs {
  file_path: string | null
  folder_path: string | null
  line_number: number | null
  search_directory: string | null
  search_mode: boolean
  search_pattern: string | null
  search_cs: boolean
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

const isMarkdownFile = (name: string): boolean => {
  const ext = name.split('.').pop()?.toLowerCase()
  return ext === 'md' || ext === 'markdown'
}

const isCsvFile = (name: string): boolean => {
  return name.split('.').pop()?.toLowerCase() === 'csv'
}

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
  const [appMode, setAppMode] = useState<'editor' | 'search'>('editor')
  const [searchParams, setSearchParams] = useState({ pattern: '', caseSensitive: false })
  const [statusMessage, setStatusMessage] = useState('Ready')
  const [theme, setTheme] = useState<Theme>('light')
  const [isTailMode, setIsTailMode] = useState(false)
  const [fontSize, setFontSize] = useState(14)
  const [encoding, setEncoding] = useState('auto')
  const [lineEnding, setLineEnding] = useState('CRLF')
  const [searchDirectory, setSearchDirectory] = useState('')
  const [showPathMenu, setShowPathMenu] = useState(false)
  const [previewMode, setPreviewMode] = useState(false)
  const [folderPath, setFolderPath] = useState<string>('')
  const [showSidebar, setShowSidebar] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(250)
  const isResizingRef = useRef(false)
  const pathMenuRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorRef>(null)
  const tailUnlistenRef = useRef<(() => void) | null>(null)
  const isModifiedRef = useRef(isModified)

  // Sidebar resize logic
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.body.classList.add('is-resizing');
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      
      const newWidth = e.clientX;
      if (newWidth >= 150 && newWidth <= 600) {
        setSidebarWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      document.body.classList.remove('is-resizing');
    };

    if (showSidebar) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [showSidebar]);

  // MarkdownファイルかどうかをfileNameから判定
  const isMarkdown = isMarkdownFile(fileName)
  const isCsv = isCsvFile(fileName)

  // 非Markdown/CSVファイルを開いたらpreviewModeをリセット
  // CSVファイルの場合はデフォルトでプレビュー(グリッド)モードにする
  useEffect(() => {
    if (!isMarkdown && !isCsv) {
      setPreviewMode(false)
    } else if (isCsv) {
      setPreviewMode(true)
    }
  }, [isMarkdown, isCsv])

  // Sync isModifiedRef with isModified state for use in event listeners
  useEffect(() => {
    isModifiedRef.current = isModified
  }, [isModified])

  // Intercept window close request if there are unsaved changes
  useEffect(() => {
    if (!isTauri()) return

    const setupCloseHandler = async () => {
      const unlisten = await getCurrentWindow().onCloseRequested(async (event) => {
        // Tauri v2 では async コールバック内でのイベント処理が非同期になるため、
        // 常に preventDefault() を先に呼んで、その後 destroy() で明示的に閉じる
        event.preventDefault()

        if (isModifiedRef.current) {
          const confirmed = await ask(
            '変更が保存されていません。保存せずに終了しますか？',
            { title: 'Bokuno Editor', kind: 'warning', okLabel: 'はい', cancelLabel: 'いいえ' }
          )
          if (confirmed) {
            await getCurrentWindow().destroy()
          }
        } else {
          // 未保存がなければ即座に閉じる
          await getCurrentWindow().destroy()
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

  // Handle new window
  const handleNewWindow = useCallback(async () => {
    try {
      await invoke('spawn_new_window')
    } catch (error) {
      setStatusMessage(`Error opening new window: ${error}`)
    }
  }, [])

  // Shared load file function
  const loadFile = useCallback(async (selectedPath: string) => {
    if (isTailMode) {
      await stopTail()
    }
    
    // Check if there are unsaved changes
    if (isModifiedRef.current) {
      const confirmed = await ask(
        '変更が保存されていません。別のファイルを開くと変更が破棄されます。よろしいですか？',
        { title: 'Bokuno Editor', kind: 'warning', okLabel: 'はい', cancelLabel: 'いいえ' }
      )
      if (!confirmed) return
    }

    try {
      setStatusMessage('Loading...')
      const readRequest: ReadRequest = { file_path: selectedPath, encoding }
      const result = await invoke<FileContent>('read_file', { 
        request: readRequest 
      })
      setFileContent(result.content)
      setFileName(result.file_name)
      setFilePath(result.file_path)
      setEncoding(result.encoding)
      setIsModified(false)
      setSearchDirectory(getDirectoryFromPath(result.file_path))
      setStatusMessage(`Opened: ${result.file_name} (${encoding})`)
    } catch (error) {
      setStatusMessage(`Error: ${error}`)
    }
  }, [encoding, isTailMode, stopTail])

  // Handle file open
  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await open({ multiple: false, directory: false })
      if (!selected || typeof selected !== 'string') return
      await loadFile(selected)
    } catch (error) {
      setStatusMessage(`Error opening dialog: ${error}`)
    }
  }, [loadFile])

  // Handle folder open
  const handleOpenFolder = useCallback(async () => {
    try {
      const selected = await open({ directory: true })
      if (!selected || typeof selected !== 'string') return
      setFolderPath(selected)
      setShowSidebar(true)
      setStatusMessage(`Opened folder: ${selected}`)
    } catch (error) {
      setStatusMessage(`Error opening folder: ${error}`)
    }
  }, [])

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
      setEncoding(result.encoding)
      setIsModified(false)
      setStatusMessage(`Reopened: ${result.file_name} (${encoding})`)
    } catch (error) {
      setStatusMessage(`Error reopening: ${error}`)
    }
  }, [filePath, encoding, isModified, isTailMode, stopTail])

  // Handle search
  const handleSearch = useCallback(async (directory: string, pattern: string, caseSensitive: boolean) => {
    try {
      await invoke('spawn_search_window', {
        directory,
        pattern,
        caseSensitive
      })
      setShowSearch(false)
    } catch (error) {
      setStatusMessage(`Search error: ${error}`)
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
          const result = await invoke<FileContent>('read_file', { 
            request: { file_path: filePath } 
          })
          setFileContent(result.content)
          setEncoding(result.encoding)
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
        
        // If folder path provided, open it in sidebar
        if (args.folder_path) {
          setFolderPath(args.folder_path)
          setShowSidebar(true)
          setStatusMessage(`Opened folder: ${args.folder_path}`)
        }

        // If file path provided, open it
        if (args.file_path) {
          setStatusMessage('Loading...')
          const result = await invoke<FileContent>('read_file', { 
            request: { file_path: args.file_path } 
          })
          setFileContent(result.content)
          setFileName(result.file_name)
          setFilePath(result.file_path)
          setEncoding(result.encoding)
          setIsModified(false)
          setSearchDirectory(getDirectoryFromPath(result.file_path))
          setStatusMessage(`Opened: ${result.file_name}`)
          
          if (args.line_number) {
            setTimeout(() => editorRef.current?.scrollToLine(args.line_number!), 100)
          }
        }
        
        if (args.search_mode && args.search_directory && args.search_pattern) {
          setAppMode('search')
          setSearchDirectory(args.search_directory)
          setSearchParams({ pattern: args.search_pattern, caseSensitive: args.search_cs })
        } else if (args.search_directory && !args.search_mode) {
          // If search directory provided, open search panel with it
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
          case 'n':
            e.preventDefault()
            handleNewWindow()
            break
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
  }, [handleNewWindow, handleOpenFile, handleSaveFile])

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
            <button 
              className={`action-btn ${showSidebar ? 'action-btn--active' : ''}`}
              onClick={() => setShowSidebar(prev => !prev)} 
              title="Toggle Sidebar" 
              aria-label="Toggle Sidebar"
            >
              <Icon name="sidebar" />
            </button>
            <div className="action-separator" />
            <button className="action-btn" onClick={handleNewWindow} title="New Window (Ctrl+N)" aria-label="New Window">
              <Icon name="plus" />
            </button>
            <button className="action-btn" onClick={handleOpenFile} title="Open File (Ctrl+O)" aria-label="Open File">
              <Icon name="open" />
            </button>
            <button className="action-btn" onClick={handleOpenFolder} title="Open Folder" aria-label="Open Folder">
              <Icon name="folder-open" />
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

            { (isMarkdown || isCsv) && (
              <>
                <div className="action-separator" />
                <button
                  onClick={() => setPreviewMode(false)}
                  title="Edit mode"
                  aria-label="Edit mode"
                  className={`action-btn ${!previewMode ? 'action-btn--active' : ''}`}
                >
                  <Icon name="edit" />
                </button>
                <button
                  onClick={() => setPreviewMode(true)}
                  title="Preview mode"
                  aria-label="Preview mode"
                  className={`action-btn ${previewMode ? 'action-btn--active' : ''}`}
                >
                  <Icon name="preview" />
                </button>
              </>
            )}
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
        {showSidebar && (
          <>
            <aside className="app-sidebar" style={{ width: sidebarWidth }}>
              <FileTree 
                rootPath={folderPath} 
                onFileSelect={(path) => loadFile(path)}
                selectedPath={filePath}
              />
            </aside>
            <div 
              className="sidebar-resizer" 
              onMouseDown={handleMouseDown}
            />
          </>
        )}
        <section className="workspace-main">
          <div className="editor-frame">
            {appMode === 'search' ? (
              <SearchResultsView 
                directory={searchDirectory}
                pattern={searchParams.pattern}
                caseSensitive={searchParams.caseSensitive}
                theme={theme}
              />
            ) : (isMarkdown || isCsv) && previewMode ? (
              isCsv ? (
                <CsvEditor
                  content={fileContent}
                  theme={theme}
                  onChange={handleContentChange}
                />
              ) : (
                <MarkdownPreview
                  content={fileContent}
                  theme={theme}
                />
              )
            ) : (
              <Editor
                ref={editorRef}
                initialContent={fileContent}
                fileName={fileName}
                theme={theme}
                readOnly={isTailMode}
                fontSize={fontSize}
                onChange={handleContentChange}
              />
            )}
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
                  <option value="auto">Auto (自動判定)</option>
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
            onSearch={handleSearch}
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
          <span className="status-pill">{isTailMode ? 'Read only' : ((isMarkdown || isCsv) && previewMode ? 'Preview' : 'Editable')}</span>
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
