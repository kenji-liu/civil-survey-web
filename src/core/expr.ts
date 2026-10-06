// 進階組合斷面用的運算式直譯器（安全：自行解析，不使用 eval）
// 支援：+ − * / % ^、比較（< <= > >= = <>）、AND OR NOT、括號、函數呼叫
// 函數：ABS SQRT SIN COS TAN ATAN（角度以度計）MIN MAX ROUND INT IF IN TAB EH
// 變數不分大小寫，可用中文名稱。

export class ExprError extends Error {}

type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; name: string }
  | { t: 'un'; op: string; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; name: string; args: Node[] };

export interface ExprEnv {
  vars: Record<string, number>;
  /** IN(表名, 關鍵值)：內插表；TAB(表名, 關鍵值)：層階表 */
  table?(kind: 'IN' | 'TAB', name: string, key: number): number;
  /** EH(距離)：距中心線指定距離（向外為正）的原地面高程 */
  eh?(offset: number): number;
}

interface Tok { k: 'num' | 'id' | 'op' | 'str' | 'end'; v: string; pos: number }

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|^\.\d+/))) { out.push({ k: 'num', v: m[0], pos: i }); i += m[0].length; continue; }
    if ((m = rest.match(/^[\p{L}_][\p{L}\p{N}_]*/u))) { out.push({ k: 'id', v: m[0], pos: i }); i += m[0].length; continue; }
    if ((m = rest.match(/^"([^"]*)"|^'([^']*)'/))) { out.push({ k: 'str', v: m[1] ?? m[2], pos: i }); i += m[0].length; continue; }
    if ((m = rest.match(/^(<=|>=|<>|!=|==|&&|\|\||[-+*/%^()<>=,!])/))) { out.push({ k: 'op', v: m[0], pos: i }); i += m[0].length; continue; }
    throw new ExprError(`第 ${i + 1} 個字元「${c}」無法辨識`);
  }
  out.push({ k: 'end', v: '', pos: src.length });
  return out;
}

function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek().k === 'op' && peek().v === v;
  const isWord = (w: string) => peek().k === 'id' && peek().v.toUpperCase() === w;
  const expect = (v: string) => { if (!isOp(v)) throw new ExprError(`缺少「${v}」`); p++; };

  const or = (): Node => { let a = and(); while (isWord('OR') || isOp('||')) { p++; a = { t: 'bin', op: 'OR', a, b: and() }; } return a; };
  const and = (): Node => { let a = not(); while (isWord('AND') || isOp('&&')) { p++; a = { t: 'bin', op: 'AND', a, b: not() }; } return a; };
  const not = (): Node => { if (isWord('NOT') || isOp('!')) { p++; return { t: 'un', op: 'NOT', a: not() }; } return cmp(); };
  const cmp = (): Node => {
    const a = add();
    const t = peek();
    if (t.k === 'op' && ['<', '<=', '>', '>=', '=', '==', '<>', '!='].includes(t.v)) { p++; return { t: 'bin', op: t.v === '==' ? '=' : t.v === '!=' ? '<>' : t.v, a, b: add() }; }
    return a;
  };
  const add = (): Node => { let a = mul(); while (isOp('+') || isOp('-')) { const op = toks[p++].v; a = { t: 'bin', op, a, b: mul() }; } return a; };
  const mul = (): Node => { let a = unary(); while (isOp('*') || isOp('/') || isOp('%')) { const op = toks[p++].v; a = { t: 'bin', op, a, b: unary() }; } return a; };
  const unary = (): Node => { if (isOp('-') || isOp('+')) { const op = toks[p++].v; return { t: 'un', op, a: unary() }; } return pow(); };
  const pow = (): Node => { const a = primary(); if (isOp('^')) { p++; return { t: 'bin', op: '^', a, b: unary() }; } return a; };
  const primary = (): Node => {
    const t = peek();
    if (t.k === 'num') { p++; return { t: 'num', v: Number(t.v) }; }
    if (t.k === 'str') { p++; return { t: 'str', v: t.v }; }
    if (t.k === 'id') {
      p++;
      if (isOp('(')) {
        p++;
        const args: Node[] = [];
        if (!isOp(')')) { do { args.push(or()); } while (isOp(',') && ++p); }
        expect(')');
        return { t: 'call', name: t.v.toUpperCase(), args };
      }
      return { t: 'id', name: t.v.toUpperCase() };
    }
    if (isOp('(')) { p++; const e = or(); expect(')'); return e; }
    throw new ExprError(t.k === 'end' ? '運算式不完整' : `「${t.v}」的位置不對`);
  };
  const root = or();
  if (peek().k !== 'end') throw new ExprError(`多出「${peek().v}」`);
  return root;
}

const D2R = Math.PI / 180;

function evalNode(n: Node, env: ExprEnv): number {
  switch (n.t) {
    case 'num': return n.v;
    case 'str': throw new ExprError(`文字「${n.v}」只能當表名`);
    case 'id': {
      const v = env.vars[n.name];
      if (v === undefined) throw new ExprError(`未定義的變數 ${n.name}`);
      return v;
    }
    case 'un': {
      const a = evalNode(n.a, env);
      return n.op === '-' ? -a : n.op === 'NOT' ? (a ? 0 : 1) : a;
    }
    case 'bin': {
      if (n.op === 'AND') return evalNode(n.a, env) && evalNode(n.b, env) ? 1 : 0;
      if (n.op === 'OR') return evalNode(n.a, env) || evalNode(n.b, env) ? 1 : 0;
      const a = evalNode(n.a, env), b = evalNode(n.b, env);
      switch (n.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': if (b === 0) throw new ExprError('除以 0'); return a / b;
        case '%': return a % b;
        case '^': return Math.pow(a, b);
        case '<': return a < b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        case '=': return Math.abs(a - b) < 1e-9 ? 1 : 0;
        case '<>': return Math.abs(a - b) >= 1e-9 ? 1 : 0;
      }
      throw new ExprError(`未知運算子 ${n.op}`);
    }
    case 'call': {
      const A = n.args;
      const num = (i: number) => evalNode(A[i], env);
      const need = (k: number) => { if (A.length < k) throw new ExprError(`${n.name} 需要 ${k} 個參數`); };
      switch (n.name) {
        case 'ABS': need(1); return Math.abs(num(0));
        case 'SQRT': need(1); { const v = num(0); if (v < 0) throw new ExprError('SQRT 參數為負'); return Math.sqrt(v); }
        case 'SIN': need(1); return Math.sin(num(0) * D2R);
        case 'COS': need(1); return Math.cos(num(0) * D2R);
        case 'TAN': need(1); return Math.tan(num(0) * D2R);
        case 'ATAN': need(1); return Math.atan(num(0)) / D2R;
        case 'MIN': need(1); return Math.min(...A.map((_, i) => num(i)));
        case 'MAX': need(1); return Math.max(...A.map((_, i) => num(i)));
        case 'INT': need(1); return Math.trunc(num(0));
        case 'ROUND': need(1); { const f = Math.pow(10, A.length > 1 ? num(1) : 0); return Math.round(num(0) * f) / f; }
        case 'IF': need(3); return num(0) ? num(1) : num(2);
        case 'IN': case 'TAB': {
          need(2);
          const nameNode = A[0];
          const name = nameNode.t === 'id' ? nameNode.name : nameNode.t === 'str' ? nameNode.v.toUpperCase() : '';
          if (!name) throw new ExprError(`${n.name} 的第一個參數要是表名`);
          if (!env.table) throw new ExprError('沒有可查的表');
          return env.table(n.name as 'IN' | 'TAB', name, num(1));
        }
        case 'EH': need(1); if (!env.eh) throw new ExprError('EH 只能用在橫斷面'); return env.eh(num(0));
      }
      throw new ExprError(`未知函數 ${n.name}`);
    }
  }
}

const cache = new Map<string, Node>();

/** 計算運算式；空白回傳 fallback */
export function evaluate(src: string, env: ExprEnv, fallback = 0): number {
  const s = src.trim();
  if (!s) return fallback;
  let node = cache.get(s);
  if (!node) { node = parse(s); if (cache.size > 2000) cache.clear(); cache.set(s, node); }
  const v = evalNode(node, env);
  if (!isFinite(v)) throw new ExprError('結果不是有限數值');
  return v;
}

/** 只檢查語法（介面即時提示用） */
export function checkSyntax(src: string): string | null {
  try { if (src.trim()) parse(src.trim()); return null; } catch (e) { return (e as Error).message; }
}

/** 內插表（線性內插，超出範圍取端點）與層階表（取不大於關鍵值的最近一級） */
export function lookup(kind: 'IN' | 'TAB', rows: Array<{ k: number; v: number }>, key: number): number {
  const r = [...rows].sort((a, b) => a.k - b.k);
  if (!r.length) throw new ExprError('查表沒有資料');
  if (kind === 'TAB') {
    let v = r[0].v;
    for (const row of r) if (key >= row.k - 1e-9) v = row.v;
    return v;
  }
  if (key <= r[0].k) return r[0].v;
  if (key >= r[r.length - 1].k) return r[r.length - 1].v;
  for (let i = 1; i < r.length; i++) {
    if (key <= r[i].k) { const a = r[i - 1], b = r[i]; return a.v + ((key - a.k) / (b.k - a.k)) * (b.v - a.v); }
  }
  return r[r.length - 1].v;
}

/** 解析「W=0.5; H=CH*1.5」形式的參數設定 */
export function parseAssignments(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(/[;；\n]/)) {
    const m = part.match(/^\s*([\p{L}_][\p{L}\p{N}_]*)\s*=\s*(.+?)\s*$/u);
    if (m) out[m[1].toUpperCase()] = m[2];
  }
  return out;
}
