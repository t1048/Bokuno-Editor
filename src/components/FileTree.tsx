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
}

interface TreeNodeProps {
  entry: FileEntry;
  level: number;
  onFileSelect: (path: string) => void;
  selectedPath?: string;
}

const TreeNode = ({ entry, level, onFileSelect, selectedPath }: TreeNodeProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [children, setChildren] = useState<FileEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const isSelected = selectedPath === entry.path;

  const toggleOpen = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!entry.is_dir) {
      onFileSelect(entry.path);
      return;
    }

    if (!isOpen && children === null) {
      setIsLoading(true);
      try {
        const entries = await invoke<FileEntry[]>('read_directory', { path: entry.path });
        setChildren(entries);
      } catch (error) {
        console.error('Failed to read directory:', error);
      } finally {
        setIsLoading(false);
      }
    }
    setIsOpen(!isOpen);
  }, [entry, isOpen, children, onFileSelect]);

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

const FileTree = ({ rootPath, onFileSelect, selectedPath }: FileTreeProps) => {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadRoot = async () => {
      if (!rootPath) {
        if (mounted) setEntries([]);
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const result = await invoke<FileEntry[]>('read_directory', { path: rootPath });
        if (mounted) {
          setEntries(result);
        }
      } catch (err) {
        if (mounted) {
          setError(String(err));
          console.error('Failed to load root directory:', err);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    loadRoot();

    return () => {
      mounted = false;
    };
  }, [rootPath]);

  if (!rootPath) {
    return <div className="file-tree-empty">No folder opened</div>;
  }

  return (
    <div className="file-tree">
      <div className="file-tree-header">
        <span className="file-tree-title" title={rootPath}>
          EXPLORER
        </span>
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
            />
          ))
        )}
      </div>
    </div>
  );
};

export default FileTree;
