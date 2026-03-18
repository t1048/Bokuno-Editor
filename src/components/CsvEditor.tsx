import { useState, useEffect, useCallback, useRef, memo } from 'react';
// @ts-ignore
import * as ReactWindowModule from 'react-window';
// @ts-ignore
import * as AutoSizerModule from 'react-virtualized-auto-sizer';
import Papa from 'papaparse';
import { invoke } from '@tauri-apps/api/core';
import './CsvEditor.css';

// Workaround for import issues in some environments (Vite/Rolldown CJS interop)
const RW: any = (ReactWindowModule as any).default || ReactWindowModule;
const FixedSizeGrid = RW.FixedSizeGrid;
const FixedSizeList = RW.FixedSizeList;

const AS: any = (AutoSizerModule as any).default || AutoSizerModule;
const AutoSizer = AS;

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

interface CellProps {
  columnIndex: number;
  rowIndex: number;
  style: React.CSSProperties;
  data: {
    data: string[][];
    onCellChange: (r: number, c: number, v: string) => void;
  };
}

const Cell = memo(({ columnIndex, rowIndex, style, data }: CellProps) => {
  const value = data.data[rowIndex]?.[columnIndex] || '';
  
  return (
    <div className="csv-cell" style={style}>
      <input
        type="text"
        value={value}
        onChange={(e) => data.onCellChange(rowIndex, columnIndex, e.target.value)}
        className="csv-input"
      />
    </div>
  );
});

export default function CsvEditor({ content, filePath, theme, onChange }: CsvEditorProps) {
  const [data, setData] = useState<string[][]>([['']]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const isInternalChange = useRef(false);
  const gridRef = useRef<any>(null);
  const headerRef = useRef<any>(null);
  const sideRef = useRef<any>(null);
  const canUseLegacyVirtualGrid = Boolean(FixedSizeGrid && FixedSizeList && AutoSizer);

  // Sync scrolling
  const onScroll = useCallback(({ scrollLeft, scrollTop }: { scrollLeft: number; scrollTop: number }) => {
    headerRef.current?.scrollTo(scrollLeft);
    sideRef.current?.scrollTo(scrollTop);
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

  if (!canUseLegacyVirtualGrid) {
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
        <AutoSizer>
          {({ height, width }: any) => (
            <div style={{ position: 'relative', width, height }}>
              {/* Corner */}
              <div 
                className="csv-cell-header csv-corner" 
                style={{ 
                    position: 'absolute', 
                    top: 0, 
                    left: 0, 
                    width: HEADER_WIDTH, 
                    height: HEADER_HEIGHT,
                    zIndex: 30
                }} 
              />
              
              {/* Column Headers (Horizontal List) */}
              <div style={{ 
                  position: 'absolute', 
                  top: 0, 
                  left: HEADER_WIDTH, 
                  width: width - HEADER_WIDTH, 
                  height: HEADER_HEIGHT,
                  overflow: 'hidden',
                  zIndex: 20
              }}>
                <FixedSizeList
                  ref={headerRef}
                  height={HEADER_HEIGHT}
                  itemCount={colCount}
                  itemSize={COL_WIDTH}
                  layout="horizontal"
                  width={width - HEADER_WIDTH}
                  style={{ overflow: 'hidden' }}
                >
                  {({ index, style }: any) => (
                    <div className="csv-cell-header csv-col-header" style={style}>
                      <div className="csv-header-content">
                        <span className="csv-header-title">{getColumnName(index)}</span>
                      </div>
                    </div>
                  )}
                </FixedSizeList>
              </div>

              {/* Row Headers (Vertical List) */}
              <div style={{ 
                  position: 'absolute', 
                  top: HEADER_HEIGHT, 
                  left: 0, 
                  width: HEADER_WIDTH, 
                  height: height - HEADER_HEIGHT,
                  overflow: 'hidden',
                  zIndex: 20
              }}>
                <FixedSizeList
                  ref={sideRef}
                  height={height - HEADER_HEIGHT}
                  itemCount={rowCount}
                  itemSize={ROW_HEIGHT}
                  width={HEADER_WIDTH}
                  style={{ overflow: 'hidden' }}
                >
                  {({ index, style }: any) => (
                    <div className="csv-cell-header csv-row-header" style={style}>
                      <div className="csv-header-content">
                        <span className="csv-header-title">{index + 1}</span>
                      </div>
                    </div>
                  )}
                </FixedSizeList>
              </div>

              {/* Main Grid */}
              <div style={{ 
                  position: 'absolute', 
                  top: HEADER_HEIGHT, 
                  left: HEADER_WIDTH, 
                  width: width - HEADER_WIDTH, 
                  height: height - HEADER_HEIGHT 
              }}>
                <FixedSizeGrid
                  ref={gridRef}
                  columnCount={colCount}
                  columnWidth={COL_WIDTH}
                  height={height - HEADER_HEIGHT}
                  rowCount={rowCount}
                  rowHeight={ROW_HEIGHT}
                  width={width - HEADER_WIDTH}
                  onScroll={onScroll}
                  itemData={{ data, onCellChange: handleCellChange }}
                >
                  {Cell}
                </FixedSizeGrid>
              </div>
            </div>
          )}
        </AutoSizer>
      </div>
      {isLoading && <div className="csv-loading-overlay">読み込み中...</div>}
    </div>
  );
}
