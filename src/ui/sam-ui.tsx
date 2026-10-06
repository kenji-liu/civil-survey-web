// 第三版：自動連線成圖（S.A.M）面板與圖例庫
import type { Project } from '../core/model';
import type { Derived } from '../store/derived';
import { CTRL_INFO, DEFAULT_LEGEND, type LegendItem } from '../core/sam';
import { patch } from '../store/store';
import { toCsv, decodeText } from '../io/csv';
import { Card, Check, Btn, Kpi, Note, download, pickFile, stamp, safeName } from './common';
import { EditTable, type Col } from './EditTable';

export function SamPanel({ p, d, toast }: { p: Project; d: Derived; toast(m: string, t?: 'ok' | 'warn'): void }) {
  const s = d.sam;
  const coded = p.points.filter(q => q.code).length;
  const unknown = s ? [...s.unknown.entries()].sort((a, b) => b[1] - a[1]) : [];
  return (
    <>
      <Card title="自動連線成圖">
        <p className="hint">依測點的連線代碼（PCODE）自動畫出房屋、道路、圍牆、駁坎等地物線與電桿、樹等符號。測點依匯入順序（即外業施測順序）處理。</p>
        <Check id="sam-on" label="啟用自動連線" checked={p.sam.enabled} onChange={v => patch('sam', { ...p.sam, enabled: v })} />
        <Check id="sam-brk" label="圖例標為「斷線」的地物線加入三角網（坎、溝、路緣、溪流）" checked={p.sam.useBreaklines} onChange={v => patch('sam', { ...p.sam, useBreaklines: v })} />
        <div className="kpis">
          <Kpi label="有代碼的測點" value={`${coded} / ${p.points.length}`} />
          <Kpi label="地物線" value={String(s?.lines.length ?? 0)} />
          <Kpi label="獨立物符號" value={String(s?.symbols.length ?? 0)} />
          <Kpi label="三角網斷線段" value={String(d.tin?.nBreakEdges ?? 0)} tone={d.tin?.warning ? 'warn' : undefined} />
        </div>
        {d.tin?.warning && <Note tone="warn">{d.tin.warning}</Note>}
        {s && s.errors.length > 0 && (
          <Note tone="warn">
            <b>{s.errors.length} 個代碼有問題：</b>
            <div className="err-list">{s.errors.map((e, i) => <span key={i}>點 {e.point}「{e.code}」：{e.msg}</span>)}</div>
          </Note>
        )}
        {unknown.length > 0 && <Note>圖例庫沒有定義的代碼（不畫）：{unknown.map(([k, n]) => `${k}×${n}`).join('、')}。可在下方圖例庫新增。</Note>}
      </Card>
      <Card title="代碼寫法">
        <p className="hint">地類屬性 + 線別號碼 + 連線控制碼 + 附加部份。例：<code>BD1L</code> 房屋 1 號線轉折點、<code>RD2B</code> 路邊線 2 號切線弧、<code>IC2O3.5</code> 圓心半徑 3.5 m、<code>BD1D-5-1.5+4.5</code> 直角支距、<code>Q3G105</code> 連到點 105。共點用 <code>.</code> 隔開（<code>BD1L.BW1S.E</code>），樓層用 <code>..</code>（<code>BD1L..3R</code>）。數字碼也可：<code>1512</code>＝房屋 1 號線轉折點。</p>
        <div className="code-ref">
          {CTRL_INFO.map(([c, n, t]) => <span key={c} style={{ display: 'contents' }}><b>{c}</b><b>{n}</b><span>{t}</span></span>)}
        </div>
      </Card>
      <Card title="圖例庫">
        <div className="btn-grid">
          <Btn onClick={() => download(`${safeName(p.info.name)}_圖例庫_${stamp()}.csv`, legendCsv(p.legend), 'text/csv;charset=utf-8')}>匯出圖例庫 CSV</Btn>
          <Btn onClick={async () => {
            const f = await pickFile('.csv');
            if (!f) return;
            const items = parseLegendCsv(decodeText(await f.arrayBuffer()));
            if (!items.length) { toast('檔案中沒有讀到圖例', 'warn'); return; }
            patch('legend', items);
            toast(`已載入 ${items.length} 個圖例`, 'ok');
          }}>匯入圖例庫</Btn>
          <Btn kind="ghost" onClick={() => { patch('legend', DEFAULT_LEGEND.map(l => ({ ...l }))); toast('已還原預設圖例庫（Ctrl+Z 可復原）'); }}>還原預設</Btn>
        </div>
        <p className="hint">不同業主的編碼不同，可以在下方表格修改代碼、名稱、DXF 圖層與線型，也能整批從 Excel 貼上。</p>
      </Card>
    </>
  );
}

const STYLES: Array<[string, string]> = [['solid', '實線'], ['dash', '虛線'], ['dot', '點線'], ['wall', '圍牆（刻線）'], ['bank', '駁坎（長刻線）'], ['fence', '柵欄（叉號）']];
const SYMBOLS: Array<[string, string]> = [['pole', '電桿'], ['tel', '電信桿'], ['lamp', '路燈'], ['hydrant', '消防栓'], ['manhole', '人孔'], ['tree', '樹'], ['mark', '菱形']];

const LEGEND_COLS: Col<LegendItem>[] = [
  { key: 'code', label: '英文碼', type: 'text', width: 52 },
  { key: 'num', label: '數字碼', type: 'text', width: 44 },
  { key: 'name', label: '名稱', type: 'text', width: 76 },
  { key: 'kind', label: '類別', type: 'select', options: [['line', '地物線'], ['point', '獨立物'], ['none', '不繪']] },
  { key: 'color', label: '顏色', type: 'color' },
  { key: 'layer', label: 'DXF 圖層', type: 'text', width: 96 },
  { key: 'style', label: '線型', type: 'select', options: STYLES },
  { key: 'symbol', label: '符號', type: 'select', options: SYMBOLS },
  { key: 'breakline', label: '斷線', type: 'bool' },
];

export function SamDrawer({ p, d }: { p: Project; d: Derived }) {
  const s = d.sam;
  const usage = new Map<string, number>();
  for (const ln of s?.lines ?? []) usage.set(ln.feature, (usage.get(ln.feature) ?? 0) + 1);
  for (const sy of s?.symbols ?? []) usage.set(sy.feature, (usage.get(sy.feature) ?? 0) + 1);
  return (
    <EditTable cols={LEGEND_COLS} rows={p.legend}
      blank={(): LegendItem => ({ code: '', num: '', name: '', kind: 'line', color: '#e2e8f0', layer: 'SAM_', style: 'solid', symbol: 'mark', breakline: false })}
      onChange={rows => patch('legend', rows.map(r => ({ ...r, code: r.code.toUpperCase() })))}
      extra={[{ label: '本圖使用', render: r => usage.get(r.code.toUpperCase()) ?? '' }]} />
  );
}

function legendCsv(items: LegendItem[]) {
  return toCsv([['英文碼', '數字碼', '名稱', '類別', '顏色', '圖層', '線型', '符號', '斷線'], ...items.map(l => [l.code, l.num, l.name, l.kind, l.color, l.layer, l.style, l.symbol, l.breakline ? 1 : 0])]);
}

function parseLegendCsv(text: string): LegendItem[] {
  const out: LegendItem[] = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    const c = line.split(',').map(x => x.trim().replace(/^"|"$/g, ''));
    if (!c[0]) continue;
    out.push({
      code: c[0].toUpperCase(), num: c[1] ?? '', name: c[2] ?? c[0],
      kind: (['line', 'point', 'none'].includes(c[3]) ? c[3] : 'line') as LegendItem['kind'],
      color: /^#[0-9a-f]{6}$/i.test(c[4] ?? '') ? c[4] : '#e2e8f0', layer: c[5] || `SAM_${c[0]}`,
      style: (STYLES.some(s => s[0] === c[6]) ? c[6] : 'solid') as LegendItem['style'],
      symbol: (SYMBOLS.some(s => s[0] === c[7]) ? c[7] : 'mark') as LegendItem['symbol'],
      breakline: c[8] === '1' || /true/i.test(c[8] ?? ''),
    });
  }
  return out;
}
