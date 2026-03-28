import { useState, useEffect, useCallback, useRef } from 'react';
// @ts-ignore
import { Grid, List } from 'react-window';
import Papa from 'papaparse';
import { invoke } from '@tauri-apps/api/core';
import './CsvEditor.css';

type CellPosition = { row: number; col: number };

interface CsvEditorProps {
  content: string;
  filePath?: string;
  theme: 'light' | 'dark';
  onChange: (content: string) => void;
}

const ROW_HEIGHT = 32;
const COL_WIDTH = 150;
const HEADER_WIDTH = 60;
const HEADER_HEIGHT = 32;

interface FileMetadata {
  size: number;
  encoding: string;
}

function isSameCell(a: CellPosition | null, b: CellPosition | null) {
  return a?.row === b?.row && a?.col === b?.col;
}

function clampCellPosition(position: CellPosition, rowCount: number, colCount: number): CellPosition {
  return {
    row: Math.max(0, Math.min(position.row, rowCount - 1)),
    col: Math.max(0, Math.min(position.col, colCount - 1)),
  };
}

function isComposingEnter(event: React.KeyboardEvent<HTMLElement>, isComposing: boolean) {
  const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean; keyCode?: number };
  return event.key === 'Enter' && (isComposing || nativeEvent.isComposing === true || nativeEvent.keyCode === 229);
}

function normalizeData(rows: string[][]) {
  if (rows.length === 0) {
    return [['']];
  }

  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  return rows.map((row) => {
    const nextRow = [...row];
    while (nextRow.length < columnCount) {
      nextRow.push('');
    }
    return nextRow;
  });
}

function parseCsv(content: string) {
  if (content === '') {
    return [['']];
  }

  const result = Papa.parse<string[]>(content, { skipEmptyLines: false });
  return normalizeData(result.data);
}

function getColumnName(index: number) {
  let name = '';
  let i = index;
  while (i >= 0) {
    name = String.fromCharCode(65 + (i % 26)) + name;
    i = Math.floor(i / 26) - 1;
  }
  return name;
}

interface CellDataProps {
  data: string[][];
  isLoading: boolean;
  onCellChange: (r: number, c: number, v: string) => void;
  onSelectCell: (r: number, c: number) => void;
  onStartEditingCell: (r: number, c: number) => void;
  onStopEditingCell: (r: number, c: number) => void;
  onCellViewerKeyDown: (event: React.KeyboardEvent<HTMLDivElement>, row: number, col: number) => void;
  onCellEditorKeyDown: (event: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => void;
  onCellCompositionStart: () => void;
  onCellCompositionEnd: () => void;
  selectedCell: CellPosition | null;
  editingCell: CellPosition | null;
}

interface CellProps extends CellDataProps {
  columnIndex: number;
  rowIndex: number;
  style: React.CSSProperties;
  ariaAttributes: {
    'aria-colindex': number;
    role: 'gridcell';
  };
}

function Cell({
  columnIndex,
  rowIndex,
  style,
  ariaAttributes,
  data,
  isLoading,
  onCellChange,
  onSelectCell,
  onStartEditingCell,
  onStopEditingCell,
  onCellViewerKeyDown,
  onCellEditorKeyDown,
  onCellCompositionStart,
  onCellCompositionEnd,
  selectedCell,
  editingCell,
}: CellProps) {
  const value = data[rowIndex]?.[columnIndex] || '';
  const isSelected = selectedCell?.row === rowIndex && selectedCell?.col === columnIndex;
  const isEditing = editingCell?.row === rowIndex && editingCell?.col === columnIndex;
  
  return (
    <div className={`csv-cell ${isSelected ? 'csv-cell--selected' : ''}`} style={style} {...ariaAttributes}>
      {isEditing ? (
        <input
          type="text"
          value={value}
          disabled={isLoading}
          onChange={(e) => onCellChange(rowIndex, columnIndex, e.target.value)}
          onKeyDown={(event) => onCellEditorKeyDown(event, rowIndex, columnIndex)}
          onCompositionStart={onCellCompositionStart}
          onCompositionEnd={onCellCompositionEnd}
          onBlur={() => onStopEditingCell(rowIndex, columnIndex)}
          onFocus={() => onSelectCell(rowIndex, columnIndex)}
          onClick={() => onSelectCell(rowIndex, columnIndex)}
          className="csv-input"
          data-cell-row={rowIndex}
          data-cell-col={columnIndex}
          data-cell-mode="editor"
        />
      ) : (
        <div
          className="csv-cell-view"
          tabIndex={isSelected ? 0 : -1}
          onFocus={() => onSelectCell(rowIndex, columnIndex)}
          onClick={() => onSelectCell(rowIndex, columnIndex)}
          onDoubleClick={() => onStartEditingCell(rowIndex, columnIndex)}
          onKeyDown={(event) => onCellViewerKeyDown(event, rowIndex, columnIndex)}
          data-cell-row={rowIndex}
          data-cell-col={columnIndex}
          data-cell-mode="viewer"
        >
          {value || <span className="csv-cell-placeholder"></span>}
        </div>
      )}
    </div>
  );
}

interface HeaderCellProps {
  columnIndex: number;
  style: React.CSSProperties;
  selectedColumn: number | null;
  isLoading: boolean;
  colCount: number;
  onDeleteColumn: (colIndex: number) => void;
  onSelectColumn: (colIndex: number) => void;
  ariaAttributes: {
    'aria-colindex': number;
    role: 'gridcell';
  };
}

function HeaderCell({
  columnIndex,
  style,
  selectedColumn,
  isLoading,
  colCount,
  onDeleteColumn,
  onSelectColumn,
  ariaAttributes,
}: HeaderCellProps) {
  const isSelected = selectedColumn === columnIndex;
  const columnName = getColumnName(columnIndex);
  return (
    <div
      className={`csv-cell-header csv-col-header ${isSelected ? 'csv-header--selected' : ''}`}
      style={style}
      onClick={() => onSelectColumn(columnIndex)}
      {...ariaAttributes}
    >
      <span className="csv-header-title">{columnName}</span>
      <button
        type="button"
        className="csv-header-delete-btn"
        title={`${columnName}列を削除`}
        aria-label={`${columnName}列を削除`}
        disabled={isLoading || colCount <= 1}
        onClick={(e) => { e.stopPropagation(); onDeleteColumn(columnIndex); }}
      >
        ×
      </button>
    </div>
  );
}

interface RowHeaderProps {
  index: number;
  style: React.CSSProperties;
  selectedRow: number | null;
  isLoading: boolean;
  rowCount: number;
  onDeleteRow: (index: number) => void;
  onSelectRow: (index: number) => void;
  ariaAttributes: {
    'aria-posinset': number;
    'aria-setsize': number;
    role: 'listitem';
  };
}

function RowHeader({
  index,
  style,
  selectedRow,
  isLoading,
  rowCount,
  onDeleteRow,
  onSelectRow,
  ariaAttributes,
}: RowHeaderProps) {
  const isSelected = selectedRow === index;
  const rowLabel = `${index + 1}`;
  return (
    <div
      className={`csv-cell-header csv-row-header ${isSelected ? 'csv-header--selected' : ''}`}
      style={style}
      onClick={() => onSelectRow(index)}
      {...ariaAttributes}
    >
      <span className="csv-header-title">{rowLabel}</span>
      <button
        type="button"
        className="csv-header-delete-btn"
        title={`${rowLabel}行を削除`}
        aria-label={`${rowLabel}行を削除`}
        disabled={isLoading || rowCount <= 1}
        onClick={(e) => { e.stopPropagation(); onDeleteRow(index); }}
      >
        ×
      </button>
    </div>
  );
}

export default function CsvEditor({ content, filePath, theme, onChange }: CsvEditorProps) {
  const [data, setData] = useState<string[][]>([['']]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [selectedCell, setSelectedCell] = useState<CellPosition | null>(null);
  const [editingCell, setEditingCell] = useState<CellPosition | null>(null);
  const isInternalChange = useRef(false);
  const loadRequestId = useRef(0);
  const gridRef = useRef<any>(null);
  const headerRef = useRef<any>(null);
  const sideRef = useRef<any>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const isComposingRef = useRef(false);
  const scrollTopRef = useRef(0);
  const scrollLeftRef = useRef(0);
  const canUseVirtualGrid = true;

  const [hoveredRowBoundary, setHoveredRowBoundary] = useState<number | null>(null);
  const [hoveredColBoundary, setHoveredColBoundary] = useState<number | null>(null);

  const emitChange = useCallback((nextData: string[][]) => {
    const csv = Papa.unparse(nextData);
    isInternalChange.current = true;
    onChange(csv);
  }, [onChange]);

  // Sync scrolling
  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const { scrollLeft, scrollTop } = event.currentTarget;
    scrollTopRef.current = scrollTop;
    scrollLeftRef.current = scrollLeft;
    if (headerRef.current?.element && headerRef.current.element.scrollLeft !== scrollLeft) {
      headerRef.current.element.scrollLeft = scrollLeft;
    }
    if (sideRef.current?.element && sideRef.current.element.scrollTop !== scrollTop) {
      sideRef.current.element.scrollTop = scrollTop;
    }
  }, []);

  const loadStreaming = useCallback(async (path: string) => {
    const requestId = ++loadRequestId.current;
    setIsLoading(true);
    setLoadError(null);
    setLoadProgress(null);
    try {
      const metadata = await invoke<FileMetadata>('get_file_metadata', { filePath: path });
      const CHUNK_SIZE = 1024 * 512;
      const chunks: string[] = [];
      let start = 0;
      let totalSize = metadata.size;

      if (totalSize === 0) {
        if (loadRequestId.current === requestId) {
          const nextData = [['']];
          setData(nextData);
          setSelectedCell({ row: 0, col: 0 });
          setEditingCell(null);
        }
        return;
      }

      while (start < totalSize) {
        const chunk = await invoke<any>('read_file_chunk', {
          request: {
            file_path: path,
            start,
            length: CHUNK_SIZE,
            encoding: metadata.encoding,
          },
        });

        if (loadRequestId.current !== requestId) {
          return;
        }

        chunks.push(chunk.content);
        start = chunk.start + chunk.length;
        totalSize = chunk.total_size;
        setLoadProgress({ loaded: Math.min(start, totalSize), total: totalSize });
      }

      if (loadRequestId.current === requestId) {
        const nextData = parseCsv(chunks.join(''));
        setData(nextData);
        setSelectedCell((prev) => {
          if (!prev) {
            return { row: 0, col: 0 };
          }

          return {
            row: Math.min(prev.row, nextData.length - 1),
            col: Math.min(prev.col, nextData[0].length - 1),
          };
        });
        setEditingCell(null);
      }
    } catch (e) {
      console.error('Streaming load error:', e);
      if (loadRequestId.current === requestId) {
        setLoadError('CSVの読み込みに失敗しました。');
      }
    } finally {
      if (loadRequestId.current === requestId) {
        setIsLoading(false);
        setLoadProgress(null);
      }
    }
  }, []);

  useEffect(() => {
    if (isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }

    if (filePath && content === '') {
      loadStreaming(filePath);
    } else {
      loadRequestId.current += 1;
      setIsLoading(false);
      setLoadProgress(null);
      setLoadError(null);
      setEditingCell(null);
      try {
        const nextData = parseCsv(content);
        setData(nextData);
        setSelectedCell((prev) => {
          if (!prev) {
            return { row: 0, col: 0 };
          }

          return {
            row: Math.min(prev.row, nextData.length - 1),
            col: Math.min(prev.col, nextData[0].length - 1),
          };
        });
      } catch (e) {
        console.error('CSV parse error:', e);
        setLoadError('CSVの解析に失敗しました。');
      }
    }
  }, [content, filePath, loadStreaming]);

  const rowCount = data.length;
  const colCount = data[0]?.length || 1;

  const handleCellChange = useCallback((rIndex: number, cIndex: number, value: string) => {
    if (isLoading) {
      return;
    }

    setData(prev => {
        const newData = [...prev];
        if (!newData[rIndex]) newData[rIndex] = [];
        newData[rIndex] = [...newData[rIndex]];
        newData[rIndex][cIndex] = value;
        emitChange(newData);
        
        return newData;
    });
  }, [emitChange, isLoading]);

  const handleSelectCell = useCallback((row: number, col: number) => {
    setSelectedCell({ row, col });
  }, []);

  const focusSelectedCell = useCallback((targetCell: CellPosition, mode: 'viewer' | 'editor') => {
    let attempts = 0;
    const tryFocus = () => {
      const root = editorRef.current;
      if (!root) {
        return;
      }

      const selector = `[data-cell-row="${targetCell.row}"][data-cell-col="${targetCell.col}"][data-cell-mode="${mode}"]`;
      const element = root.querySelector<HTMLElement>(selector);
      if (element) {
        if (document.activeElement !== element) {
          element.focus();
        }
        return;
      }

      attempts += 1;
      if (attempts < 4) {
        requestAnimationFrame(tryFocus);
      }
    };

    requestAnimationFrame(tryFocus);
  }, []);

  const moveSelection = useCallback((nextCell: CellPosition) => {
    const clampedCell = clampCellPosition(nextCell, rowCount, colCount);
    setSelectedCell(clampedCell);
    setEditingCell(null);
    if (canUseVirtualGrid) {
      gridRef.current?.scrollToCell({ columnIndex: clampedCell.col, rowIndex: clampedCell.row });
    }
  }, [canUseVirtualGrid, colCount, rowCount]);

  const startEditingCell = useCallback((row: number, col: number) => {
    if (isLoading) {
      return;
    }

    const cell = clampCellPosition({ row, col }, rowCount, colCount);
    setSelectedCell(cell);
    setEditingCell(cell);
    if (canUseVirtualGrid) {
      gridRef.current?.scrollToCell({ columnIndex: cell.col, rowIndex: cell.row });
    }
  }, [canUseVirtualGrid, colCount, isLoading, rowCount]);

  const stopEditingCell = useCallback((row: number, col: number) => {
    setEditingCell((current) => {
      if (current?.row !== row || current?.col !== col) {
        return current;
      }

      return null;
    });
    isComposingRef.current = false;
  }, []);

  const handleCellViewerKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>, row: number, col: number) => {
    if (isLoading) {
      return;
    }

    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault();
        moveSelection({ row: row - 1, col });
        break;
      case 'ArrowDown':
        event.preventDefault();
        moveSelection({ row: row + 1, col });
        break;
      case 'ArrowLeft':
        event.preventDefault();
        moveSelection({ row, col: col - 1 });
        break;
      case 'ArrowRight':
        event.preventDefault();
        moveSelection({ row, col: col + 1 });
        break;
      case 'Enter':
      case 'F2':
        event.preventDefault();
        startEditingCell(row, col);
        break;
      default:
        break;
    }
  }, [isLoading, moveSelection, startEditingCell]);

  const handleCellEditorKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
    if (event.key !== 'Enter') {
      return;
    }

    if (isComposingEnter(event, isComposingRef.current)) {
      return;
    }

    event.preventDefault();
    stopEditingCell(row, col);
    setSelectedCell({ row, col });
  }, [stopEditingCell]);

  useEffect(() => {
    if (!selectedCell) {
      return;
    }

    const activeMode = isSameCell(selectedCell, editingCell) ? 'editor' : 'viewer';
    if (canUseVirtualGrid) {
      gridRef.current?.scrollToCell({ columnIndex: selectedCell.col, rowIndex: selectedCell.row });
    }
    focusSelectedCell(selectedCell, activeMode);
  }, [canUseVirtualGrid, editingCell, focusSelectedCell, selectedCell]);

  const handleSelectRow = useCallback((rowIndex: number) => {
    setEditingCell(null);
    setSelectedCell((prev) => ({ row: rowIndex, col: prev?.col ?? 0 }));
  }, []);

  const handleSelectColumn = useCallback((colIndex: number) => {
    setEditingCell(null);
    setSelectedCell((prev) => ({ row: prev?.row ?? 0, col: colIndex }));
  }, []);

  const handleContainerMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const relX = event.clientX - rect.left;
    const relY = event.clientY - rect.top;
    const scrollTop = scrollTopRef.current;
    const scrollLeft = scrollLeftRef.current;

    if (relY > HEADER_HEIGHT) {
      const dataY = relY - HEADER_HEIGHT + scrollTop;
      const boundaryIndex = Math.round(dataY / ROW_HEIGHT);
      const boundaryScreenY = HEADER_HEIGHT + boundaryIndex * ROW_HEIGHT - scrollTop;
      if (Math.abs(relY - boundaryScreenY) < 7 && boundaryIndex >= 0 && boundaryIndex <= rowCount) {
        setHoveredRowBoundary(boundaryIndex);
      } else {
        setHoveredRowBoundary(null);
      }
    } else {
      setHoveredRowBoundary(null);
    }

    if (relX > HEADER_WIDTH) {
      const dataX = relX - HEADER_WIDTH + scrollLeft;
      const boundaryIndex = Math.round(dataX / COL_WIDTH);
      const boundaryScreenX = HEADER_WIDTH + boundaryIndex * COL_WIDTH - scrollLeft;
      if (Math.abs(relX - boundaryScreenX) < 7 && boundaryIndex >= 0 && boundaryIndex <= colCount) {
        setHoveredColBoundary(boundaryIndex);
      } else {
        setHoveredColBoundary(null);
      }
    } else {
      setHoveredColBoundary(null);
    }
  }, [rowCount, colCount]);

  const handleContainerMouseLeave = useCallback(() => {
    setHoveredRowBoundary(null);
    setHoveredColBoundary(null);
  }, []);

  const handleInsertRowAt = useCallback((insertIndex: number) => {
    if (isLoading) return;
    setEditingCell(null);
    setData((prev) => {
      const safeData = normalizeData(prev);
      const nextRow = Array.from({ length: safeData[0].length }, () => '');
      const nextData = [...safeData];
      nextData.splice(insertIndex, 0, nextRow);
      emitChange(nextData);
      return nextData;
    });
    setSelectedCell((prev) => ({ row: insertIndex, col: prev?.col ?? 0 }));
  }, [emitChange, isLoading]);

  const handleInsertRowBefore = useCallback((rowIndex: number) => {
    handleInsertRowAt(rowIndex);
  }, [handleInsertRowAt]);

  const handleInsertRowAfter = useCallback((rowIndex: number) => {
    handleInsertRowAt(rowIndex + 1);
  }, [handleInsertRowAt]);

  const handleDeleteRow = useCallback((rowIndex: number) => {
    if (isLoading || data.length <= 1) return;
    setEditingCell(null);
    setData((prev) => {
      const safeData = normalizeData(prev);
      const nextData = safeData.filter((_, index) => index !== rowIndex);
      const normalizedNextData = normalizeData(nextData);
      emitChange(normalizedNextData);
      return normalizedNextData;
    });
    setSelectedCell((prev) => ({
      row: Math.min(rowIndex, data.length - 2),
      col: prev?.col ?? 0,
    }));
  }, [data.length, emitChange, isLoading]);

  const handleInsertColumnAt = useCallback((insertIndex: number) => {
    if (isLoading) return;
    setEditingCell(null);
    setData((prev) => {
      const safeData = normalizeData(prev);
      const nextData = safeData.map((row) => {
        const nextRow = [...row];
        nextRow.splice(insertIndex, 0, '');
        return nextRow;
      });
      emitChange(nextData);
      return nextData;
    });
    setSelectedCell((prev) => ({ row: prev?.row ?? 0, col: insertIndex }));
  }, [emitChange, isLoading]);

  const handleInsertColumnBefore = useCallback((colIndex: number) => {
    handleInsertColumnAt(colIndex);
  }, [handleInsertColumnAt]);

  const handleInsertColumnAfter = useCallback((colIndex: number) => {
    handleInsertColumnAt(colIndex + 1);
  }, [handleInsertColumnAt]);

  const handleDeleteColumn = useCallback((colIndex: number) => {
    if (isLoading || (data[0]?.length ?? 0) <= 1) return;
    setEditingCell(null);
    setData((prev) => {
      const safeData = normalizeData(prev);
      const nextData = safeData.map((row) => row.filter((_, index) => index !== colIndex));
      const normalizedNextData = normalizeData(nextData);
      emitChange(normalizedNextData);
      return normalizedNextData;
    });
    setSelectedCell((prev) => ({
      row: prev?.row ?? 0,
      col: Math.min(colIndex, (data[0]?.length ?? 2) - 2),
    }));
  }, [data, emitChange, isLoading]);

  const selectedRow = selectedCell?.row ?? null;
  const selectedColumn = selectedCell?.col ?? null;
  const loadingLabel = loadProgress
    ? `読み込み中... ${Math.round((loadProgress.loaded / loadProgress.total) * 100)}%`
    : '読み込み中...';

  if (!canUseVirtualGrid) {
    return (
      <div className={`csv-editor csv-theme-${theme} ${isLoading ? 'is-loading' : ''}`} ref={editorRef}>
        {loadError && <div className="csv-error-banner">{loadError}</div>}
        <div className="csv-fallback-container">
          <table className="csv-fallback-table">
            <thead>
              <tr>
                <th className="csv-fallback-index">#</th>
                {Array.from({ length: colCount }).map((_, index) => (
                  <th key={index} className={`csv-cell-header csv-col-header ${selectedColumn === index ? 'csv-header--selected' : ''}`} onClick={() => handleSelectColumn(index)}>
                    <span className="csv-header-title">{getColumnName(index)}</span>
                    <button type="button" className="csv-header-delete-btn" title={`${getColumnName(index)}列を削除`} aria-label={`${getColumnName(index)}列を削除`} disabled={isLoading || colCount <= 1} onClick={(e) => { e.stopPropagation(); handleDeleteColumn(index); }}>×</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <td className={`csv-cell-header csv-row-header csv-fallback-index ${selectedRow === rowIndex ? 'csv-header--selected' : ''}`} onClick={() => handleSelectRow(rowIndex)}>
                    <span className="csv-header-title">{rowIndex + 1}</span>
                    <button type="button" className="csv-header-delete-btn" title={`${rowIndex + 1}行を削除`} aria-label={`${rowIndex + 1}行を削除`} disabled={isLoading || rowCount <= 1} onClick={(e) => { e.stopPropagation(); handleDeleteRow(rowIndex); }}>×</button>
                  </td>
                  {Array.from({ length: colCount }).map((_, colIndex) => (
                    <td key={colIndex}>
                      {editingCell?.row === rowIndex && editingCell?.col === colIndex ? (
                        <input
                          type="text"
                          value={row[colIndex] || ''}
                          disabled={isLoading}
                          onChange={(e) => handleCellChange(rowIndex, colIndex, e.target.value)}
                          onKeyDown={(event) => handleCellEditorKeyDown(event, rowIndex, colIndex)}
                          onCompositionStart={() => { isComposingRef.current = true; }}
                          onCompositionEnd={() => { isComposingRef.current = false; }}
                          onBlur={() => stopEditingCell(rowIndex, colIndex)}
                          onFocus={() => handleSelectCell(rowIndex, colIndex)}
                          onClick={() => handleSelectCell(rowIndex, colIndex)}
                          className="csv-input"
                          data-cell-row={rowIndex}
                          data-cell-col={colIndex}
                          data-cell-mode="editor"
                        />
                      ) : (
                        <div
                          className="csv-cell-view"
                          tabIndex={selectedCell?.row === rowIndex && selectedCell?.col === colIndex ? 0 : -1}
                          onFocus={() => handleSelectCell(rowIndex, colIndex)}
                          onClick={() => handleSelectCell(rowIndex, colIndex)}
                          onDoubleClick={() => startEditingCell(rowIndex, colIndex)}
                          onKeyDown={(event) => handleCellViewerKeyDown(event, rowIndex, colIndex)}
                          data-cell-row={rowIndex}
                          data-cell-col={colIndex}
                          data-cell-mode="viewer"
                        >
                          {row[colIndex] || <span className="csv-cell-placeholder"></span>}
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {isLoading && <div className="csv-loading-overlay">{loadingLabel}</div>}
      </div>
    );
  }

  return (
    <div className={`csv-editor csv-theme-${theme} ${isLoading ? 'is-loading' : ''}`} ref={editorRef}>
      {loadError && <div className="csv-error-banner">{loadError}</div>}
      <div className="csv-virtual-container">
        <div
          style={{ position: 'relative', width: '100%', height: '100%' }}
          onMouseMove={handleContainerMouseMove}
          onMouseLeave={handleContainerMouseLeave}
        >
          <div
            className="csv-cell-header csv-corner"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: HEADER_WIDTH,
              height: HEADER_HEIGHT,
              zIndex: 30,
            }}
          />

          <div
            style={{
              position: 'absolute',
              top: 0,
              left: HEADER_WIDTH,
              width: `calc(100% - ${HEADER_WIDTH}px)`,
              height: HEADER_HEIGHT,
              zIndex: 20,
              overflow: 'hidden',
            }}
          >
            <Grid
              gridRef={headerRef}
              columnCount={colCount}
              columnWidth={COL_WIDTH}
              defaultHeight={HEADER_HEIGHT}
              defaultWidth={COL_WIDTH * 3}
              rowCount={1}
              rowHeight={HEADER_HEIGHT}
              style={{ overflow: 'hidden' }}
              cellComponent={HeaderCell}
              cellProps={{ selectedColumn, isLoading, colCount, onDeleteColumn: handleDeleteColumn, onSelectColumn: handleSelectColumn } as any}
            />
          </div>

          <div
            style={{
              position: 'absolute',
              top: HEADER_HEIGHT,
              left: 0,
              width: HEADER_WIDTH,
              height: `calc(100% - ${HEADER_HEIGHT}px)`,
              zIndex: 20,
              overflow: 'hidden',
            }}
          >
            <List
              listRef={sideRef}
              rowCount={rowCount}
              rowHeight={ROW_HEIGHT}
              defaultHeight={ROW_HEIGHT * 10}
              style={{ overflow: 'hidden' }}
              rowComponent={RowHeader}
              rowProps={{ selectedRow, isLoading, rowCount, onDeleteRow: handleDeleteRow, onSelectRow: handleSelectRow } as any}
            />
          </div>

          <div
            style={{
              position: 'absolute',
              top: HEADER_HEIGHT,
              left: HEADER_WIDTH,
              width: `calc(100% - ${HEADER_WIDTH}px)`,
              height: `calc(100% - ${HEADER_HEIGHT}px)`,
            }}
          >
            <Grid
              gridRef={gridRef}
              columnCount={colCount}
              columnWidth={COL_WIDTH}
              defaultHeight={ROW_HEIGHT * 10}
              defaultWidth={COL_WIDTH * 3}
              rowCount={rowCount}
              rowHeight={ROW_HEIGHT}
              onScroll={onScroll}
              cellComponent={Cell}
              cellProps={{ data, isLoading, onCellChange: handleCellChange, onSelectCell: handleSelectCell, onStartEditingCell: startEditingCell, onStopEditingCell: stopEditingCell, onCellViewerKeyDown: handleCellViewerKeyDown, onCellEditorKeyDown: handleCellEditorKeyDown, onCellCompositionStart: () => { isComposingRef.current = true; }, onCellCompositionEnd: () => { isComposingRef.current = false; }, selectedCell, editingCell } as any}
            />
          </div>

          {hoveredRowBoundary !== null && (() => {
            const y = HEADER_HEIGHT + hoveredRowBoundary * ROW_HEIGHT - scrollTopRef.current;
            if (y < HEADER_HEIGHT) return null;
            return (
              <div
                className="csv-insert-line csv-insert-row-line"
                style={{ top: y }}
              >
                <button
                  type="button"
                  className="csv-insert-btn"
                  disabled={isLoading}
                  title={hoveredRowBoundary === 0 ? '先頭に行を挿入' : `${hoveredRowBoundary}行目の後に行を挿入`}
                  onClick={(e) => { e.stopPropagation(); handleInsertRowAt(hoveredRowBoundary); }}
                  onMouseEnter={() => setHoveredRowBoundary(hoveredRowBoundary)}
                >
                  +
                </button>
              </div>
            );
          })()}

          {hoveredColBoundary !== null && (() => {
            const x = HEADER_WIDTH + hoveredColBoundary * COL_WIDTH - scrollLeftRef.current;
            if (x < HEADER_WIDTH) return null;
            return (
              <div
                className="csv-insert-line csv-insert-col-line"
                style={{ left: x }}
              >
                <button
                  type="button"
                  className="csv-insert-btn"
                  disabled={isLoading}
                  title={hoveredColBoundary === 0 ? '先頭に列を挿入' : `${getColumnName(hoveredColBoundary - 1)}列の後に列を挿入`}
                  onClick={(e) => { e.stopPropagation(); handleInsertColumnAt(hoveredColBoundary); }}
                  onMouseEnter={() => setHoveredColBoundary(hoveredColBoundary)}
                >
                  +
                </button>
              </div>
            );
          })()}
        </div>
      </div>
      {isLoading && <div className="csv-loading-overlay">{loadingLabel}</div>}
    </div>
  );
}
