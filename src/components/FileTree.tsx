import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
}

interface TreeNodeProps {
  entry: FileEntry;
  level: number;
  onFileSelect: (path: string) => void;
  selectedPath?: string;
  onRefreshParent: () => void;
  onFileDeleted?: (path: string) => void;
}

const TreeNode = ({ entry, level, onFileSelect, selectedPath, onRefreshParent, onFileDeleted }: TreeNodeProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const isSelected = selectedPath === entry.path;

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

  const handleCreateFile = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const fileName = window.prompt(`${entry.name} フォルダ内に作成する新しいファイル名を入力してください:`);
    if (!fileName) return;

    const newFilePath = `${entry.path}/${fileName}`;
    try {
      await invoke('write_file', { 
        request: { 
          file_path: newFilePath, 
          content: '', 
          encoding: 'utf-8', 
          line_ending: 'LF' 
        } 
      });
      await refreshChildren();
      if (!isOpen) setIsOpen(true);
      onFileSelect(newFilePath);
    } catch (error) {
      console.error('Failed to create file:', error);
      alert(`ファイルの作成に失敗しました: ${error}`);
    }
  }, [entry, isOpen, onFileSelect, refreshChildren]);

  const handleCreateFolder = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const folderName = window.prompt(`${entry.name} フォルダ内に作成する新しいフォルダ名を入力してください:`);
    if (!folderName) return;

    const newFolderPath = `${entry.path}/${folderName}`;
    try {
      await invoke('create_directory', { path: newFolderPath });
      await refreshChildren();
      if (!isOpen) setIsOpen(true);
    } catch (error) {
      console.error('Failed to create folder:', error);
      alert(`フォルダの作成に失敗しました: ${error}`);
    }
  }, [entry, isOpen, refreshChildren]);

  const handleDelete = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    const typeName = entry.is_dir ? 'フォルダ' : 'ファイル';
    const isConfirmed = window.confirm(`本当に${typeName}「${entry.name}」を削除しますか？\nこの操作は元に戻せません。`);
    
    if (!isConfirmed) return;

    try {
      if (entry.is_dir) {
        await invoke('remove_directory', { path: entry.path });
      } else {
        await invoke('remove_file', { path: entry.path });
      }
      onRefreshParent();
      if (onFileDeleted) {
        onFileDeleted(entry.path);
      }
    } catch (error) {
      console.error(`Failed to delete ${typeName}:`, error);
      alert(`${typeName}の削除に失敗しました: ${error}`);
    }
  }, [entry, onRefreshParent, onFileDeleted]);

  return (
    <div className="tree-node-container">
      <div
        className={`tree-node ${isSelected ? 'tree-node--selected' : ''}`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={toggleOpen}
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
        <span className="tree-node-name">{entry.name}</span>
        
        <div className="tree-node-actions-container">
          {entry.is_dir && (
            <>
              <button 
                className="tree-node-action" 
                onClick={handleCreateFile}
                title="新規ファイル作成"
              >
                <Icon name="plus" size={12} />
              </button>
              <button 
                className="tree-node-action" 
                onClick={handleCreateFolder}
                title="新規フォルダ作成"
              >
                <Icon name="folder-plus" size={12} />
              </button>
            </>
          )}
          <button 
            className="tree-node-action tree-node-action--danger" 
            onClick={handleDelete}
            title="削除"
          >
            <Icon name="trash" size={12} />
          </button>
        </div>
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

const FileTree = ({ rootPath, onFileSelect, selectedPath, onFileDeleted }: FileTreeProps) => {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleCreateFileRoot = useCallback(async () => {
    if (!rootPath) return;
    const fileName = window.prompt(`新しいファイル名を入力してください:`);
    if (!fileName) return;

    const newFilePath = `${rootPath}/${fileName}`;
    try {
      await invoke('write_file', { 
        request: { 
          file_path: newFilePath, 
          content: '', 
          encoding: 'utf-8', 
          line_ending: 'LF' 
        } 
      });
      await loadRoot();
      onFileSelect(newFilePath);
    } catch (error) {
      console.error('Failed to create file:', error);
      alert(`ファイルの作成に失敗しました: ${error}`);
    }
  }, [rootPath, onFileSelect, loadRoot]);

  const handleCreateFolderRoot = useCallback(async () => {
    if (!rootPath) return;
    const folderName = window.prompt(`新しいフォルダ名を入力してください:`);
    if (!folderName) return;

    const newFolderPath = `${rootPath}/${folderName}`;
    try {
      await invoke('create_directory', { path: newFolderPath });
      await loadRoot();
    } catch (error) {
      console.error('Failed to create folder:', error);
      alert(`フォルダの作成に失敗しました: ${error}`);
    }
  }, [rootPath, loadRoot]);

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
            onClick={handleCreateFileRoot}
            title="新規ファイル作成"
          >
            <Icon name="plus" size={14} />
          </button>
          <button 
            className="file-tree-header-action" 
            onClick={handleCreateFolderRoot}
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
            <TreeNode
              key={entry.path}
              entry={entry}
              level={0}
              onFileSelect={onFileSelect}
              selectedPath={selectedPath}
              onRefreshParent={loadRoot}
              onFileDeleted={onFileDeleted}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default FileTree;
