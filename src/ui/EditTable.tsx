// 通用可編輯表格：鍵盤上下移動、Enter 換列、可從 Excel 貼上多列多欄
import { useRef, useState } from 'react';

export interface Col<T> {
  key: keyof T & string;
  label: string;
  /** num：數字（空白存 null 或 0）；text：文字（含 ddd.mmss 角度）；select：下拉；bool：勾選；color：顏色 */
  type: 'num' | 'text' | 'select' | 'bool' | 'color';
  options?: Array<[string, string]>;
  /** 數字欄允許空白（存 null） */
  nullable?: boolean;
  digits?: number;
  width?: number;
  placeholder?: string;
}

export function EditTable<T extends object>(props: {
  cols: Col<T>[];
  rows: T[];
  onChange(rows: T[]): void;
  blank(): T;
  /** 每列最後加一欄唯讀的計算結果 */
  extra?: { label: string; render(row: T, i: number): React.ReactNode }[];
  selected?: number | null;
  onSelect?(i: number): void;
  emptyText?: string;
}) {
  const { cols, rows, onChange } = props;
  const tableRef = useRef<HTMLTableElement>(null);
  const [edit, setEdit] = useState<{ r: number; c: number; text: string } | null>(null);

  const show = (row: T, c: Col<T>) => {
    const v = row[c.key] as unknown;
    if (v === null || v === undefined) return '';
    if (c.type === 'num' && typeof v === 'number' && c.digits !== undefined) return v.toFixed(c.digits);
    return String(v);
  };
  const parse = (c: Col<T>, text: string): unknown => {
    if (c.type === 'bool') return /^(1|true|y|yes|是|v|✓)$/i.test(text.trim());
    if (c.type !== 'num') return text.trim();
    const t = text.trim().replace(/,/g, '');
    if (t === '') return c.nullable ? null : 0;
    const v = Number(t);
    return isFinite(v) ? v : undefined;
  };
  const commit = (r: number, c: number, text: string) => {
    const col = cols[c];
    const v = parse(col, text);
    if (v === undefined) return;
    const next = rows.slice();
    while (next.length <= r) next.push(props.blank());
    next[r] = { ...next[r], [col.key]: v };
    onChange(next);
  };
  const focusCell = (r: number, c: number) => {
    requestAnimationFrame(() => {
      const el = tableRef.current?.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`);
      el?.focus(); el?.select();
    });
  };
  const onPaste = (e: React.ClipboardEvent, r0: number, c0: number) => {
    const text = e.clipboardData.getData('text');
    if (!/[\t\n]/.test(text.trim())) return; // 單一儲存格照一般貼上
    e.preventDefault();
    const lines = text.replace(/\r/g, '').split('\n').filter((l, i, a) => l !== '' || i < a.length - 1);
    const next = rows.slice();
    lines.forEach((line, i) => {
      const cells = line.split('\t');
      const r = r0 + i;
      while (next.length <= r) next.push(props.blank());
      let row = { ...next[r] };
      cells.forEach((cell, j) => {
        const col = cols[c0 + j];
        if (!col) return;
        const v = parse(col, cell);
        if (v !== undefined) row = { ...row, [col.key]: v };
      });
      next[r] = row;
    });
    setEdit(null);
    onChange(next);
  };

  return (
    <div className="table-wrap fill">
      <table className="tbl edit" ref={tableRef}>
        <thead>
          <tr>
            <th>#</th>
            {cols.map(c => <th key={c.key}>{c.label}</th>)}
            {props.extra?.map(x => <th key={x.label}>{x.label}</th>)}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className={props.selected === r ? 'sel' : ''} onClick={() => props.onSelect?.(r)}>
              <td className="muted">{r + 1}</td>
              {cols.map((c, ci) => (
                <td key={c.key}>
                  {c.type === 'select' ? (
                    <select aria-label={c.label} value={String(row[c.key] ?? '')} onChange={e => { const n = rows.slice(); n[r] = { ...row, [c.key]: e.target.value }; onChange(n); }}>
                      {c.options!.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                    </select>
                  ) : c.type === 'bool' ? (
                    <input type="checkbox" aria-label={c.label} checked={!!row[c.key]} onChange={e => { const n = rows.slice(); n[r] = { ...row, [c.key]: e.target.checked }; onChange(n); }} />
                  ) : c.type === 'color' ? (
                    <input type="color" aria-label={c.label} className="cell-color" value={String(row[c.key] ?? '#ffffff')} onChange={e => { const n = rows.slice(); n[r] = { ...row, [c.key]: e.target.value }; onChange(n); }} />
                  ) : <input
                    className="cell" data-r={r} data-c={ci} type="text"
                    inputMode={c.type === 'num' ? 'decimal' : undefined}
                    style={c.width ? { width: c.width, minWidth: c.width } : undefined}
                    placeholder={c.placeholder}
                    value={edit && edit.r === r && edit.c === ci ? edit.text : show(row, c)}
                    onFocus={() => setEdit({ r, c: ci, text: show(row, c) })}
                    onChange={e => setEdit({ r, c: ci, text: e.target.value })}
                    onBlur={() => { if (edit && edit.r === r && edit.c === ci && edit.text !== show(row, c)) commit(r, ci, edit.text); setEdit(null); }}
                    onPaste={e => onPaste(e, r, ci)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === 'ArrowDown') {
                        e.preventDefault();
                        (e.target as HTMLInputElement).blur();
                        if (r === rows.length - 1 && e.key === 'Enter') onChange([...rows, props.blank()]);
                        focusCell(r + 1, ci);
                      } else if (e.key === 'ArrowUp' && r > 0) {
                        e.preventDefault(); (e.target as HTMLInputElement).blur(); focusCell(r - 1, ci);
                      }
                    }}
                  />}
                </td>
              ))}
              {props.extra?.map(x => <td key={x.label}>{x.render(row, r)}</td>)}
              <td>
                <button type="button" className="x" title="在此列上方插入" aria-label="插入一列" onClick={e => { e.stopPropagation(); const n = rows.slice(); n.splice(r, 0, props.blank()); onChange(n); }}>＋</button>
                <button type="button" className="x" title="刪除此列" aria-label="刪除此列" onClick={e => { e.stopPropagation(); onChange(rows.filter((_, k) => k !== r)); }}>×</button>
              </td>
            </tr>
          ))}
          <tr className="add-row">
            <td colSpan={cols.length + (props.extra?.length ?? 0) + 2}>
              <button type="button" className="btn ghost" onClick={() => { onChange([...rows, props.blank()]); focusCell(rows.length, 0); }}>＋ 新增一列</button>
              <span className="muted small">　{rows.length ? '可直接從 Excel 複製多列多欄，點儲存格後貼上' : props.emptyText ?? '尚無資料'}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
