import { useState, useEffect, useCallback, useRef } from 'react';
// @ts-ignore
import { Grid, List } from 'react-window';
import Papa from 'papaparse';
import { invoke } from '@tauri-apps/api/core';
import './CsvEditor.css';

interface CsvEditorProps {
  content: string;
  filePath?: string;
  theme: 'light' | 'dark';
  onChange: (content: string) => void;
}

const ROW_HEIGHT = 32;
const COL_WIDTH = 150;
const HEADER_WIDTH = 50;
const HEADER_HEIGHT = 32;

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
  onCellChange: (r: number, c: number, v: string) => void;
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

function Cell({ columnIndex, rowIndex, style, ariaAttributes, data, onCellChange }: CellProps) {
  const value = data[rowIndex]?.[columnIndex] || '';
  
  return (
    <div className="csv-cell" style={style} {...ariaAttributes}>
      <input
        type="text"
        value={value}
        onChange={(e) => onCellChange(rowIndex, columnIndex, e.target.value)}
        className="csv-input"
      />
    </div>
  );
}

interface HeaderCellProps {
  columnIndex: number;
  style: React.CSSProperties;
  ariaAttributes: {
    'aria-colindex': number;
    role: 'gridcell';
  };
}

function HeaderCell({ columnIndex, style, ariaAttributes }: HeaderCellProps) {
  return (
    <div className="csv-cell-header csv-col-header" style={style} {...ariaAttributes}>
      <div className="csv-header-content">
        <span className="csv-header-title">{getColumnName(columnIndex)}</span>
      </div>
    </div>
  );
}

interface RowHeaderProps {
  index: number;
  style: React.CSSProperties;
  ariaAttributes: {
    'aria-posinset': number;
    'aria-setsize': number;
    role: 'listitem';
  };
}

function RowHeader({ index, style, ariaAttributes }: RowHeaderProps) {
  return (
    <div className="csv-cell-header csv-row-header" style={style} {...ariaAttributes}>
      <div className="csv-header-content">
        <span className="csv-header-title">{index + 1}</span>
      </div>
    </div>
  );
}

export default function CsvEditor({ content, filePath, theme, onChange }: CsvEditorProps) {
  const [data, setData] = useState<string[][]>([['']]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const isInternalChange = useRef(false);
  const gridRef = useRef<any>(null);
  const headerRef = useRef<any>(null);
  const sideRef = useRef<any>(null);
  const canUseVirtualGrid = true;

  // Sync scrolling
  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const { scrollLeft, scrollTop } = event.currentTarget;
    if (headerRef.current?.element && headerRef.current.element.scrollLeft !== scrollLeft) {
      headerRef.current.element.scrollLeft = scrollLeft;
    }
    if (sideRef.current?.element && sideRef.current.element.scrollTop !== scrollTop) {
      sideRef.current.element.scrollTop = scrollTop;
    }
  }, []);

  const loadStreaming = useCallback(async (path: string) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      // metadata is fetched to ensure the file exists and get basic info
      await invoke<any>('get_file_metadata', { filePath: path });
      const CHUNK_SIZE = 1024 * 512; // 512KB for first fast display
      
      const firstChunk = await invoke<any>('read_file_chunk', { 
        request: { file_path: path, start: 0, length: CHUNK_SIZE } 
      });
      
      const result = Papa.parse<string[]>(firstChunk.content, { skipEmptyLines: false });
      if (result.data.length > 0) {
        setData(result.data);
      }
    } catch (e) {
      console.error('Streaming load error:', e);
      setLoadError('CSVの読み込みに失敗しました。');
    } finally {
      setIsLoading(false);
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
      setLoadError(null);
      try {
        const result = Papa.parse<string[]>(content, { skipEmptyLines: false });
        if (result.data.length > 0) {
          setData(result.data);
        }
      } catch (e) {
        console.error('CSV parse error:', e);
        setLoadError('CSVの解析に失敗しました。');
      }
    }
  }, [content, filePath, loadStreaming]);

  const handleCellChange = useCallback((rIndex: number, cIndex: number, value: string) => {
    setData(prev => {
        const newData = [...prev];
        if (!newData[rIndex]) newData[rIndex] = [];
        newData[rIndex] = [...newData[rIndex]];
        newData[rIndex][cIndex] = value;
        
        // Schedule onChange
        const csv = Papa.unparse(newData);
        isInternalChange.current = true;
        onChange(csv);
        
        return newData;
    });
  }, [onChange]);

  const rowCount = data.length;
  const colCount = data[0]?.length || 0;

  if (!canUseVirtualGrid) {
    return (
      <div className={`csv-editor csv-theme-${theme} ${isLoading ? 'is-loading' : ''}`}>
        {loadError && <div className="csv-error-banner">{loadError}</div>}
        <div className="csv-fallback-container">
          <table className="csv-fallback-table">
            <thead>
              <tr>
                <th className="csv-fallback-index">#</th>
                {Array.from({ length: colCount }).map((_, index) => (
                  <th key={index}>{getColumnName(index)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <td className="csv-fallback-index">{rowIndex + 1}</td>
                  {Array.from({ length: colCount }).map((_, colIndex) => (
                    <td key={colIndex}>
                      <input
                        type="text"
                        value={row[colIndex] || ''}
                        onChange={(e) => handleCellChange(rowIndex, colIndex, e.target.value)}
                        className="csv-input"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {isLoading && <div className="csv-loading-overlay">読み込み中...</div>}
      </div>
    );
  }

  return (
    <div className={`csv-editor csv-theme-${theme} ${isLoading ? 'is-loading' : ''}`}>
      {loadError && <div className="csv-error-banner">{loadError}</div>}
      <div className="csv-virtual-container">
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
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
              cellProps={{} as any}
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
              rowProps={{} as any}
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
              cellProps={{ data, onCellChange: handleCellChange } as any}
            />
          </div>
        </div>
      </div>
      {isLoading && <div className="csv-loading-overlay">読み込み中...</div>}
    </div>
  );
}
