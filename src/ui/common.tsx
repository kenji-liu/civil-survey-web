// 共用小元件
import { useEffect, useState, type ReactNode } from 'react';

export function Card(props: { title: ReactNode; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <header className="card-head"><h3>{props.title}</h3>{props.extra}</header>
      <div className="card-body">{props.children}</div>
    </section>
  );
}

/** 數字輸入：輸入時暫存字串，離開欄位或按 Enter 才寫回 */
export function NumField(props: {
  id: string; label: ReactNode; value: number; onChange(v: number): void;
  step?: number; min?: number; max?: number; unit?: string; width?: number; disabled?: boolean;
}) {
  const [text, setText] = useState(String(props.value));
  useEffect(() => { setText(String(props.value)); }, [props.value]);
  const commit = () => {
    const v = Number(text);
    if (text.trim() === '' || !isFinite(v) || (props.min !== undefined && v < props.min) || (props.max !== undefined && v > props.max)) {
      setText(String(props.value));
      return;
    }
    if (v !== props.value) props.onChange(v);
  };
  return (
    <label className="field" htmlFor={props.id}>
      <span className="field-label">{props.label}</span>
      <span className="field-input">
        <input
          id={props.id} type="text" inputMode="decimal" value={text} disabled={props.disabled}
          style={props.width ? { width: props.width } : undefined}
          onChange={e => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
        {props.unit && <span className="unit">{props.unit}</span>}
      </span>
    </label>
  );
}

export function TextField(props: { id: string; label: ReactNode; value: string; onChange(v: string): void; placeholder?: string }) {
  const [text, setText] = useState(props.value);
  useEffect(() => { setText(props.value); }, [props.value]);
  return (
    <label className="field" htmlFor={props.id}>
      <span className="field-label">{props.label}</span>
      <span className="field-input">
        <input id={props.id} type="text" value={text} placeholder={props.placeholder}
          onChange={e => setText(e.target.value)}
          onBlur={() => text !== props.value && props.onChange(text)}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      </span>
    </label>
  );
}

export function Check(props: { id: string; label: ReactNode; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="check" htmlFor={props.id}>
      <input id={props.id} type="checkbox" checked={props.checked} onChange={e => props.onChange(e.target.checked)} />
      <span>{props.label}</span>
    </label>
  );
}

export function Btn(props: { children: ReactNode; onClick(): void; kind?: 'primary' | 'accent' | 'danger' | 'ghost'; active?: boolean; title?: string; disabled?: boolean; wide?: boolean }) {
  return (
    <button type="button" title={props.title} disabled={props.disabled}
      className={`btn ${props.kind ?? ''} ${props.active ? 'active' : ''} ${props.wide ? 'wide' : ''}`}
      onClick={props.onClick}>{props.children}</button>
  );
}

export function Kpi(props: { label: string; value: string; tone?: 'cut' | 'fill' | 'ok' | 'warn' }) {
  return (
    <div className={`kpi ${props.tone ?? ''}`}>
      <span className="kpi-label">{props.label}</span>
      <span className="kpi-value">{props.value}</span>
    </div>
  );
}

export function Note(props: { tone?: 'warn' | 'info' | 'ok'; children: ReactNode }) {
  return <div className={`note ${props.tone ?? 'info'}`}>{props.children}</div>;
}

export function download(filename: string, content: string | Blob, mime = 'text/plain;charset=utf-8') {
  const blob = typeof content === 'string' ? new Blob([content], { type: mime }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/** 檔名可用的日期字串 */
export function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function safeName(s: string) {
  return (s || '未命名').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
}
