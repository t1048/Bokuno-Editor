import { useState, useEffect, useCallback, useRef } from 'react';
import './CsvEditor.css';

function parseCsv(csv: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    const nextChar = csv[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++; // skip LF
      }
      row.push(cell);
      result.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.length > 0 || result.length > 0) {
    result.push(row);
  }
  
  // ensure all rows have same number of columns
  const maxCols = Math.max(1, ...result.map(r => r.length));
  return result.map(r => {
    while (r.length < maxCols) r.push('');
    return r;
  });
}

function stringifyCsv(data: string[][]): string {
  if (data.length === 0) return '';
  return data.map(row => 
    row.map(cell => {
      if (cell.includes(',') || cell.includes('"') || cell.includes('\n') || cell.includes('\r')) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    }).join(',')
  ).join('\n');
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

interface CsvEditorProps {
  content: string;
  theme: 'light' | 'dark';
  onChange: (content: string) => void;
}

export default function CsvEditor({ content, theme, onChange }: CsvEditorProps) {
  const [data, setData] = useState<string[][]>([['']]);
  const isInternalChange = useRef(false);

  useEffect(() => {
    if (isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    setData(parseCsv(content));
  }, [content]);

  const updateData = useCallback((newData: string[][]) => {
    isInternalChange.current = true;
    setData(newData);
    onChange(stringifyCsv(newData));
  }, [onChange]);

  const handleCellChange = (rIndex: number, cIndex: number, value: string) => {
    const newData = [...data];
    newData[rIndex] = [...newData[rIndex]];
    newData[rIndex][cIndex] = value;
    updateData(newData);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rIndex: number, cIndex: number) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.target as HTMLInputElement;
      const start = target.selectionStart || 0;
      const end = target.selectionEnd || 0;
      const value = target.value;
      const newValue = value.substring(0, start) + '\t' + value.substring(end);
      
      handleCellChange(rIndex, cIndex, newValue);

      // Restore cursor position asynchronously after render
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = start + 1;
      });
    }
  };

  const addRow = (index: number) => {
    const newData = [...data];
    const colCount = newData[0]?.length || 1;
    newData.splice(index, 0, Array(colCount).fill(''));
    updateData(newData);
  };

  const removeRow = (index: number) => {
    if (data.length <= 1) return;
    const newData = [...data];
    newData.splice(index, 1);
    updateData(newData);
  };

  const addColumn = (index: number) => {
    const newData = data.map(row => {
      const newRow = [...row];
      newRow.splice(index, 0, '');
      return newRow;
    });
    updateData(newData);
  };

  const removeColumn = (index: number) => {
    if (data[0]?.length <= 1) return;
    const newData = data.map(row => {
      const newRow = [...row];
      newRow.splice(index, 1);
      return newRow;
    });
    updateData(newData);
  };

  return (
    <div className={`csv-editor csv-theme-${theme}`}>
      <div className="csv-table-container">
        <table className="csv-table">
          <thead>
            <tr>
              <th className="csv-cell-header csv-corner"></th>
              {data[0]?.map((_, cIndex) => (
                <th key={cIndex} className="csv-cell-header csv-col-header">
                  <div className="csv-header-content">
                    <span className="csv-header-title">{getColumnName(cIndex)}</span>
                    <div className="csv-header-actions">
                      <button onClick={() => addColumn(cIndex)} title="前に列を追加" aria-label="Add column before">+</button>
                      <button onClick={() => removeColumn(cIndex)} title="列を削除" aria-label="Remove column" disabled={data[0]?.length <= 1}>-</button>
                      <button onClick={() => addColumn(cIndex + 1)} title="後に列を追加" aria-label="Add column after">+</button>
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, rIndex) => (
              <tr key={rIndex}>
                <th className="csv-cell-header csv-row-header">
                  <div className="csv-header-content">
                    <span className="csv-header-title">{rIndex + 1}</span>
                    <div className="csv-header-actions csv-header-actions-vertical">
                      <button onClick={() => addRow(rIndex)} title="上に行を追加" aria-label="Add row above">+</button>
                      <button onClick={() => removeRow(rIndex)} title="行を削除" aria-label="Remove row" disabled={data.length <= 1}>-</button>
                      <button onClick={() => addRow(rIndex + 1)} title="下に行を追加" aria-label="Add row below">+</button>
                    </div>
                  </div>
                </th>
                {row.map((cell, cIndex) => (
                  <td key={cIndex} className="csv-cell">
                    <input
                      type="text"
                      value={cell}
                      onChange={(e) => handleCellChange(rIndex, cIndex, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(e, rIndex, cIndex)}
                      className="csv-input"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
