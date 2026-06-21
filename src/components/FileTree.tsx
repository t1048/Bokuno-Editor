import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { message } from '@tauri-apps/plugin-dialog';
import Icon from './Icon';
import './FileTree.css';

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface FileTreeProps {
  rootPath: string;
  onFileSelect: (path: string) => void;
  selectedPath?: string;
  onFileDeleted?: (path: string) => void;
  onFileRenamed?: (oldPath: string, newPath: string) => void;
}

interface TreeNodeProps {
  entry: FileEntry;
  level: number;
  onFileSelect: (path: string) => void;
  selectedPath?: string;
  onRefreshParent: () => void;
  onFileDeleted?: (path: string) => void;
  onFileRenamed?: (oldPath: string, newPath: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  onStartRename: (entry: FileEntry) => void;
  renamingPath: string | null;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
}

interface CreateDialogState {
  type: 'file' | 'folder';
  parentPath: string;
  value: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  entry: FileEntry;
}

const TreeNode = ({
  entry,
  level,
  onFileSelect,
  selectedPath,
  onFileDeleted,
  onFileRenamed,
  onContextMenu,
  onStartRename,
  renamingPath,
  renameValue,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
}: TreeNodeProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const isSelected = selectedPath === entry.path;
  const isRenaming = renamingPath === entry.path;

  useEffect(() => {
    if (isRenaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [isRenaming]);

  const refreshChildren = useCallback(async () => {
    if (!entry.is_dir) return;
    try {
      const entries = await invoke<FileEntry[]>('read_directory', { path: entry.path });
      setChildren(entries);
    } catch (error) {
      console.error('Failed to read directory:', error);
    }
  }, [entry]);

  const toggleOpen = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!entry.is_dir) {
      onFileSelect(entry.path);
      return;
    }

    if (!isOpen && children === null) {
      setIsLoading(true);
      await refreshChildren();
      setIsLoading(false);
    }
    setIsOpen(!isOpen);
  }, [entry, isOpen, children, onFileSelect, refreshChildren]);

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onRenameSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onRenameCancel();
    }
  };

  return (
    <div className="tree-node-container">
      <div
        className={`tree-node ${isSelected ? 'tree-node--selected' : ''}`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={toggleOpen}
        onContextMenu={(e) => onContextMenu(e, entry)}
        title={entry.name}
      >
        <span className={`tree-icon-wrapper ${entry.is_dir ? 'tree-icon-wrapper--dir' : ''}`}>
          {entry.is_dir ? (
            <Icon
              name={isOpen ? 'folder-open' : 'folder'}
              size={14}
              className={`tree-folder-icon ${isOpen ? 'open' : ''}`}
            />
          ) : (
            <Icon name="file" size={14} className="tree-file-icon" />
          )}
        </span>
        {isRenaming ? (
          <input
            ref={renameInputRef}
            className="tree-rename-input"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={onRenameSubmit}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="tree-node-name">{entry.name}</span>
        )}
      </div>

      {isOpen && entry.is_dir && (
        <div className="tree-children">
          {isLoading ? (
            <div className="tree-loading" style={{ paddingLeft: `${(level + 1) * 12 + 8}px` }}>
              Loading...
            </div>
          ) : children && children.length > 0 ? (
            children.map((child) => (
              <TreeNode
                key={child.path}
                entry={child}
                level={level + 1}
                onFileSelect={onFileSelect}
                selectedPath={selectedPath}
                onRefreshParent={refreshChildren}
                onFileDeleted={onFileDeleted}
                onFileRenamed={onFileRenamed}
                onContextMenu={onContextMenu}
                onStartRename={onStartRename}
                renamingPath={renamingPath}
                renameValue={renameValue}
                onRenameChange={onRenameChange}
                onRenameSubmit={onRenameSubmit}
                onRenameCancel={onRenameCancel}
              />
            ))
          ) : (
            <div className="tree-empty" style={{ paddingLeft: `${(level + 1) * 12 + 8}px` }}>
              (Empty folder)
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const FileTree = ({ rootPath, onFileSelect, selectedPath, onFileDeleted, onFileRenamed }: FileTreeProps) => {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [createDialog, setCreateDialog] = useState<CreateDialogState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const loadRoot = useCallback(async () => {
    if (!rootPath) {
      setEntries([]);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const result = await invoke<FileEntry[]>('read_directory', { path: rootPath });
      setEntries(result);
    } catch (err) {
      setError(String(err));
      console.error('Failed to load root directory:', err);
    } finally {
      setIsLoading(false);
    }
  }, [rootPath]);

  useEffect(() => {
    loadRoot();
  }, [loadRoot]);

  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener('click', closeMenu);
    }
    return () => document.removeEventListener('click', closeMenu);
  }, [contextMenu]);

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  const handleStartRename = useCallback((entry: FileEntry) => {
    setRenamingPath(entry.path);
    setRenameValue(entry.name);
    setContextMenu(null);
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (!renamingPath || !renameValue.trim()) {
      setRenamingPath(null);
      return;
    }

    const parentDir = renamingPath.replace(/[\\/][^\\/]*$/, '');
    const separator = renamingPath.includes('\\') ? '\\' : '/';
    const newPath = `${parentDir}${separator}${renameValue.trim()}`;

    if (newPath === renamingPath) {
      setRenamingPath(null);
      return;
    }

    try {
      await invoke('rename_path', { oldPath: renamingPath, newPath });
      await loadRoot();
      if (onFileRenamed) {
        onFileRenamed(renamingPath, newPath);
      }
      setRenamingPath(null);
    } catch (err) {
      await message(String(err), { title: 'Rename failed', kind: 'error' });
    }
  }, [renamingPath, renameValue, loadRoot, onFileRenamed]);

  const handleRenameCancel = useCallback(() => {
    setRenamingPath(null);
  }, []);

  const handleDeleteEntry = useCallback(async (entry: FileEntry) => {
    setContextMenu(null);
    const typeName = entry.is_dir ? 'フォルダ' : 'ファイル';
    try {
      if (entry.is_dir) {
        await invoke('remove_directory', { path: entry.path });
      } else {
        await invoke('remove_file', { path: entry.path });
      }
      await loadRoot();
      if (onFileDeleted) {
        onFileDeleted(entry.path);
      }
    } catch (err) {
      await message(`${typeName}の削除に失敗しました: ${err}`, { title: 'Delete failed', kind: 'error' });
    }
  }, [loadRoot, onFileDeleted]);

  const handleReveal = useCallback(async (entry: FileEntry) => {
    setContextMenu(null);
    try {
      await invoke('open_in_explorer', { filePath: entry.path });
    } catch (err) {
      await message(String(err), { title: 'Error', kind: 'error' });
    }
  }, []);

  const submitCreateDialog = useCallback(async () => {
    if (!createDialog || !createDialog.value.trim()) {
      setCreateDialog(null);
      return;
    }

    const separator = createDialog.parentPath.includes('\\') ? '\\' : '/';
    const newPath = `${createDialog.parentPath}${separator}${createDialog.value.trim()}`;

    try {
      if (createDialog.type === 'file') {
        await invoke('write_file', {
          request: {
            file_path: newPath,
            content: '',
            encoding: 'utf-8',
            line_ending: 'LF',
          },
        });
        await loadRoot();
        onFileSelect(newPath);
      } else {
        await invoke('create_directory', { path: newPath });
        await loadRoot();
      }
      setCreateDialog(null);
    } catch (err) {
      await message(String(err), { title: 'Create failed', kind: 'error' });
    }
  }, [createDialog, loadRoot, onFileSelect]);

  const treeNodeProps = {
    onFileSelect,
    selectedPath,
    onRefreshParent: loadRoot,
    onFileDeleted,
    onFileRenamed,
    onContextMenu: handleContextMenu,
    onStartRename: handleStartRename,
    renamingPath,
    renameValue,
    onRenameChange: setRenameValue,
    onRenameSubmit: handleRenameSubmit,
    onRenameCancel: handleRenameCancel,
  };

  if (!rootPath) {
    return <div className="file-tree-empty">No folder opened</div>;
  }

  return (
    <div className="file-tree">
      <div className="file-tree-header">
        <span className="file-tree-title" title={rootPath}>
          EXPLORER
        </span>
        <div className="file-tree-header-actions">
          <button
            className="file-tree-header-action"
            onClick={() => setCreateDialog({ type: 'file', parentPath: rootPath, value: '' })}
            title="新規ファイル作成"
          >
            <Icon name="plus" size={14} />
          </button>
          <button
            className="file-tree-header-action"
            onClick={() => setCreateDialog({ type: 'folder', parentPath: rootPath, value: '' })}
            title="新規フォルダ作成"
          >
            <Icon name="folder-plus" size={14} />
          </button>
        </div>
      </div>
      <div className="file-tree-content">
        {isLoading ? (
          <div className="file-tree-loading">Loading folder...</div>
        ) : error ? (
          <div className="file-tree-error">{error}</div>
        ) : entries.length === 0 ? (
          <div className="file-tree-empty">Folder is empty</div>
        ) : (
          entries.map((entry) => (
            <TreeNode key={entry.path} entry={entry} level={0} {...treeNodeProps} />
          ))
        )}
      </div>

      {contextMenu && (
        <div
          className="tree-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {!contextMenu.entry.is_dir && (
            <button onClick={() => { onFileSelect(contextMenu.entry.path); setContextMenu(null); }}>
              開く
            </button>
          )}
          <button onClick={() => handleStartRename(contextMenu.entry)}>名前を変更</button>
          <button onClick={() => handleReveal(contextMenu.entry)}>エクスプローラーで表示</button>
          <button className="tree-context-menu--danger" onClick={() => handleDeleteEntry(contextMenu.entry)}>
            削除
          </button>
        </div>
      )}

      {createDialog && (
        <div className="tree-dialog-overlay" onClick={() => setCreateDialog(null)}>
          <div className="tree-dialog" onClick={(e) => e.stopPropagation()}>
            <h4>{createDialog.type === 'file' ? '新規ファイル' : '新規フォルダ'}</h4>
            <input
              autoFocus
              value={createDialog.value}
              onChange={(e) => setCreateDialog({ ...createDialog, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitCreateDialog();
                if (e.key === 'Escape') setCreateDialog(null);
              }}
              placeholder={createDialog.type === 'file' ? 'filename.txt' : 'folder-name'}
            />
            <div className="tree-dialog-actions">
              <button onClick={() => setCreateDialog(null)}>キャンセル</button>
              <button className="tree-dialog-primary" onClick={submitCreateDialog}>作成</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileTree;
