// 暗転の自動テスト
// index.html のスクリプトをそのまま Node で動かし（画面・音は最小限の偽物で置き換える）、
// 列の生成が理不尽にならないこと、保存データの扱い、1ラウンドの流れが例外なく進むことを確かめる。
// 使い方: node tools/test.mjs（要 Node.js 18 以降。ほかに入れるものは無い）
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(process.env.ANTEN_HTML || path.join(root, 'index.html'), 'utf8');
const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));

function makeApp({ storage = {}, w = 390, h = 844, storageThrows = false } = {}) {
  const store = new Map(Object.entries(storage));
  const ctx2d = new Proxy({}, { get: (t, p) => (p in t ? t[p] : () => ({ addColorStop() {} })), set: (t, p, v) => ((t[p] = v), true) });
  const makeEl = (id) => {
    const classes = new Set(), listeners = {};
    const el = {
      id, textContent: '', innerHTML: '', style: {}, dataset: {}, hidden: false, value: '', children: [], attrs: {},
      classList: { add: (...c) => c.forEach(x => classes.add(x)), remove: (...c) => c.forEach(x => classes.delete(x)), contains: c => classes.has(c), toggle: (c, on) => { const v = on === undefined ? !classes.has(c) : !!on; v ? classes.add(c) : classes.delete(c); return v; } },
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
      addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
      fire(t, ev = {}) { for (const fn of listeners[t] || []) fn({ type: t, target: el, preventDefault() {}, stopPropagation() {}, ...ev }); },
      appendChild(c) { this.children.push(c); return c; }, append(...c) { this.children.push(...c); }, remove() {}, closest: () => null, focus() {}, select() {},
      getBoundingClientRect: () => ({ width: w, height: h, left: 0, top: 0 }), getContext: () => ctx2d, setPointerCapture() {}, releasePointerCapture() {},
      get offsetWidth() { return 100; },
    };
    return el;
  };
  const els = new Map();
  const get = id => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };
  const seg = get('segGain'); seg.children = [1.2, 1.6, 2].map(g => { const b = makeEl('g' + g); b.dataset.g = String(g); return b; });
  const docListeners = {};
  const document = {
    getElementById: get, createElement: () => makeEl(''), querySelector: () => null, querySelectorAll: () => [], hidden: false, visibilityState: 'visible',
    body: makeEl('body'), documentElement: makeEl('html'),
    addEventListener(t, fn) { (docListeners[t] = docListeners[t] || []).push(fn); },
  };
  const fireDoc = (t, ev = {}) => { for (const fn of docListeners[t] || []) fn({ type: t, target: document.body, preventDefault() {}, stopPropagation() {}, ...ev }); };
  const localStorage = {
    getItem: k => { if (storageThrows) throw new Error('blocked'); return store.has(k) ? store.get(k) : null; },
    setItem: (k, v) => { if (storageThrows) throw new Error('blocked'); store.set(k, String(v)); },
    removeItem: k => store.delete(k),
  };
  const winListeners = {};
  const rafs = [];
  const sandbox = {
    document, localStorage, console, Math, Date, JSON, Number, String, Array, Object, Float32Array, Promise, Error, RangeError,
    navigator: { vibrate: () => true, userAgent: 'test' }, location: { protocol: 'http:', hostname: 'localhost' },
    devicePixelRatio: 2, matchMedia: () => ({ matches: false }), visualViewport: null,
    requestAnimationFrame: fn => { rafs.push(fn); return rafs.length; }, setTimeout: (fn) => 0, clearTimeout() {},
    addEventListener(t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); },
    AudioContext: undefined, PointerEvent: undefined, Capacitor: undefined,
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: 'index.html' });
  return { api: sandbox.__anten, store, fireDoc, fireWin: (t, ev = {}) => { for (const fn of winListeners[t] || []) fn({ ...ev, preventDefault() {} }); }, get, rafs };
}

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  OK  ' + name); } else { fail++; console.log('  NG  ' + name); } };

console.log('[1] 起動と生成の公平性');
{
  const { api } = makeApp();
  ok(api && typeof api.simulate === 'function', 'スクリプトが例外なく起動し __anten が作られる');
  ok(api.state === 0, '起動直後はタイトル');
  let bad = [];
  for (let seed = 1; seed <= 40; seed++) {
    const a = api.simulate({ seed, n: 500, kind: 'A' }); if (!a.ok) bad.push(`A seed${seed}@${a.died}`);
    const b = api.simulate({ seed, n: 400, kind: 'B' }); if (!b.ok) bad.push(`B seed${seed}@${b.died}`);
  }
  ok(bad.length === 0, 'ボットA（反応120ms・540px/s）が40シード×500列、ボットB（常に閉眼）が40シード×400列を無死で抜ける' + (bad.length ? ' → ' + bad.join(', ') : ''));
  const r = api.simulate({ seed: 7, n: 300, kind: 'A', log: true });
  const kinds = r.log.map(s => s.split(':')[1].replace(/[^A-Z]/g, ''));
  let run = 0, maxRun = 0; for (const k of kinds) { run = k === 'MOVE' ? run + 1 : 0; if (run > maxRun) maxRun = run; }
  ok(maxRun <= 2, '移り列が3本以上続かない（最大 ' + maxRun + '）');
  const shin = r.log.filter(s => s.includes('*'));
  ok(shin.length > 0, '忍び列が出る（' + shin.length + '本/300列）');
  let shinAdj = false; for (let i = 1; i < r.log.length; i++) if (r.log[i].includes('*') && r.log[i - 1].includes('*')) shinAdj = true;
  ok(!shinAdj, '忍び列が2本続かない');
  const flags = r.log.map(s => s.split('@')[0].split(':')[1]);
  const doubles = flags.filter(f => f.includes('d')).length, mirrors = flags.filter(f => f.includes('m')).length;
  ok(doubles > 0 && mirrors > 0, '選択列と鏡の列が出る（選択 ' + doubles + '本・鏡 ' + mirrors + '本/300列）');
  let mirRun = 0, mirMax = 0, mirBad = false; for (const f of flags) { if (f.includes('m')) { mirRun++; if (mirRun > mirMax) mirMax = mirRun; if (f.includes('*') || f.includes('d')) mirBad = true; } else mirRun = 0; }
  ok(mirMax === 3 && !mirBad, '鏡の列は3本で1組、忍び・選択とは重ならない');
  const g = [0, 5, 30, 65].map(k => api.gapAt(k));
  ok(g[0] === 170 && g[1] === 120 && g[3] === 72, '隙間の幅 170→120→72 (' + g.join(',') + ')');
  ok(api.speedAt(0) === 140 && api.speedAt(100) === 360, '速度 140→上限360');
}

console.log('[2] 1ラウンドの流れ（内部時間を進める）');
{
  const { api, store, fireDoc } = makeApp();
  const down = (x) => fireDoc('pointerdown', { clientX: x, clientY: 600, pointerId: 1, pointerType: 'touch', button: 0, target: { closest: () => null } });
  const move = (x) => fireDoc('pointermove', { clientX: x, clientY: 600, pointerId: 1 });
  const up = (x) => fireDoc('pointerup', { clientX: x, clientY: 600, pointerId: 1 });
  down(190); api.advance(0.2);
  ok(api.state === 2 && api.eye.mode === 'CLOSED', 'タイトルを触ると開始し、まぶたが閉じる');
  move(150); api.advance(0.2);
  ok(api.player.x < 180, '指を動かすと熾火が動く (x=' + Math.round(api.player.x) + ')');
  up(150); api.advance(0.2);
  ok(api.eye.mode === 'OPEN', '離すとまぶたが開く');
  api.advance(10);
  ok(api.state === 4, '動かなければいずれ死んでリザルトになる (state=' + api.state + ', 列=' + api.G.passed + ')');
  const saved = JSON.parse(store.get('anten.v1'));
  ok(saved && saved.totalPlays === 1 && saved.totalRows === api.G.passed, '保存データに回数と列数が入る');
  ok(saved.best === api.G.score, 'ベストが保存される (' + saved.best + ')');
}

console.log('[3] 保存の扱い');
{
  const { api } = makeApp({ storage: { 'anten.v1': '{broken' } });
  ok(api.S.best === 0 && api.S.settings.gain === 1.6, '壊れた保存データは初期値に戻す');
  const b = makeApp({ storage: { 'anten.v1': JSON.stringify({ v: 1, best: 123, settings: { gain: 9 } }) } });
  ok(b.api.S.best === 123 && b.api.S.settings.gain === 1.6 && b.api.S.settings.sound === true, '欠けた項目は補い、不正な感度は標準に戻す');
  const c = makeApp({ storageThrows: true });
  ok(c.api && c.api.state === 0, 'localStorage が例外を投げても起動する');
  const r1 = c.api.simulate({ seed: 3, n: 50 });
  ok(r1.ok, '保存できない環境でもゲームは進む');
}

console.log('[4] 鏡の列（閉じている間は左右が逆）');
{
  const { api, fireDoc } = makeApp();
  const down = (x) => fireDoc('pointerdown', { clientX: x, clientY: 600, pointerId: 1, pointerType: 'touch', button: 0, target: { closest: () => null } });
  const move = (x) => fireDoc('pointermove', { clientX: x, clientY: 600, pointerId: 1 });
  down(190); api.advance(0.2);
  const x0 = api.player.tx; move(220); const dxNormal = api.player.tx - x0;
  api.rows[0].mirror = true;           // 次の列を鏡にする
  const x1 = api.player.tx; move(250); const dxMirror = api.player.tx - x1;
  ok(dxNormal > 0 && dxMirror < 0 && Math.abs(Math.abs(dxMirror) - Math.abs(dxNormal)) < 1e-6, '鏡の列が次のとき指の動きが反転する (' + dxNormal + ' / ' + dxMirror + ')');
}

console.log('[5] 今日の暗転（同じ日付は同じ配置・ゴースト）');
{
  const mk = () => makeApp({ storage: { 'anten.v1': JSON.stringify({ v: 1, daily: { date: '', tries: 0, best: 0 } }) } });
  const a = mk(), b = mk();
  a.get('tDaily').fire('click'); b.get('tDaily').fire('click');
  a.api.advance(3); b.api.advance(3);
  const ra = a.api.rows.map(r => [r.k, Math.round(r.gapX), r.kind].join('/')).join(' ');
  const rb = b.api.rows.map(r => [r.k, Math.round(r.gapX), r.kind].join('/')).join(' ');
  ok(ra === rb && ra.length > 0, '2台で同じ日に同じ列が出る (' + ra.slice(0, 40) + '…)');
  ok(a.api.S.daily.date === new Date().toISOString().slice(0, 10) || a.api.S.daily.date.length === 10, '日付が入る (' + a.api.S.daily.date + ')');
  // 1回目を遊んで死ぬ → ゴーストが保存される
  const down = (x) => a.fireDoc('pointerdown', { clientX: x, clientY: 600, pointerId: 1, pointerType: 'touch', button: 0, target: { closest: () => null } });
  const up = (x) => a.fireDoc('pointerup', { clientX: x, clientY: 600, pointerId: 1 });
  down(190); a.api.advance(0.2); up(190); a.api.advance(12);
  ok(a.api.state === 4 && Array.isArray(a.api.S.daily.ghost) && a.api.S.daily.ghost.length > 10, '1回目のあとにゴースト（軌跡）が保存される (' + (a.api.S.daily.ghost || []).length + '点)');
  ok(a.api.S.daily.tries === 1 && JSON.parse(a.store.get('anten.v1')).daily.tries === 1, '挑戦の回数は始めた時点で数える (tries=' + a.api.S.daily.tries + ')');
}

console.log('[6] 設定（ゆっくり）と今週の集計');
{
  const { api, fireDoc } = makeApp();
  api.S.settings.slow = true;
  const down = (x) => fireDoc('pointerdown', { clientX: x, clientY: 600, pointerId: 1, pointerType: 'touch', button: 0, target: { closest: () => null } });
  down(190); api.advance(0.1); const mid = api.eye.mode; api.advance(0.05); const end = api.eye.mode;
  ok(mid === 'CLOSING' && end === 'CLOSED', '「ゆっくり」ではまぶたが 120ms かけて閉じる (0.1s: ' + mid + ' / 0.15s: ' + end + ')');
  api.S.dailyHistory = [{ date: '2026-10-12', best: 30 }, { date: '2026-10-13', best: 57 }, { date: '2026-10-05', best: 99 }];
  const w = api.weekSummary('2026-10-13');
  ok(w.days === 2 && w.best === 57 && w.badge === '', '今週（月曜はじまり）の日数とベストを数える (' + JSON.stringify(w) + ')');
  api.S.dailyHistory = [12, 13, 14, 15, 16, 17, 18].map(d => ({ date: '2026-10-' + d, best: d })); // 2026-10-12（月）〜18（日）
  ok(api.weekSummary('2026-10-18').badge === '皆勤' && api.weekSummary('2026-10-19').days === 0, '7日そろうと皆勤。翌週の月曜には数え直す');
}

console.log('[7] ベストに挑む（同じ配置をゴーストと走る）と称号の画像');
{
  const { api, fireDoc, get, store } = makeApp();
  const down = (x) => fireDoc('pointerdown', { clientX: x, clientY: 600, pointerId: 1, pointerType: 'touch', button: 0, target: { closest: () => null } });
  const up = (x) => fireDoc('pointerup', { clientX: x, clientY: 600, pointerId: 1 });
  down(190); api.advance(0.2); up(190);
  const row5 = () => { let n = 0, r = null; while (!(r = api.rows.find(q => q.k === 5)) && n < 200 && api.state === 2) { api.advance(0.1); n++; } return r ? Math.round(r.gapX) : null; };
  const gap5a = row5(); api.advance(12);
  const seed1 = api.G.seed;
  ok(api.state === 4 && api.S.bestGhost && api.S.bestGhost.length > 10 && api.S.bestSeed === seed1, 'エンドレスのベストで種と軌跡が保存される (seed=' + seed1 + ', ' + (api.S.bestGhost || []).length + '点)');
  ok(!get('rBest').hidden && get('rShare').hidden === false, 'リザルトに「ベストに挑む」と「称号を共有」が出る');
  get('rBest').fire('click'); api.advance(0.3);
  ok(api.mode === 'best' && api.state === 1 && api.G.seed === seed1, '「ベストに挑む」でベストと同じ種の READY になる');
  down(190); api.advance(0.2); up(190);
  const gap5b = row5();
  ok(gap5a !== null && gap5a === gap5b, '6列目（最初の乱数の列）の隙間がベストのときと同じ位置 (' + gap5a + ' / ' + gap5b + ')');
  api.advance(12); get('result').fire('pointerdown', { target: { closest: () => null } }); api.advance(0.6);
  ok(get('mode').textContent.startsWith('ベストに挑戦') || api.mode === 'best', 'HUD に「ベストに挑戦」が出る (' + get('mode').textContent + ')');
  const info = api.shareInfo();
  ok(info.rank === '見習い' && typeof info.text === 'string' && info.text.includes('github.io/anten'), '共有の文面に段位と URL が入る');
  const c = api.makeShareImage(info);
  ok(c && c.width === 1080 && c.height === 1350, '称号の画像は 1080×1350 の canvas');
  get('rEndless').fire('click'); api.advance(0.2);
  ok(api.mode === 'endless' && api.G.seed !== seed1, '「エンドレスへ」で新しい種に戻る');
  const saved = JSON.parse(store.get('anten.v1'));
  ok(Array.isArray(saved.bestGhost) && saved.bestSeed === seed1, '保存データにベストの種と軌跡が入る');
}

console.log('[8] 記録（端末内の上位10回）');
{
  const { api, fireDoc, get } = makeApp({ storage: { 'anten.v1': JSON.stringify({ v: 1, records: Array.from({ length: 12 }, (_, i) => ({ s: 50 - i, r: 20, d: 3, k: 1, date: '2026-10-01', m: 'e' })) }) } });
  ok(api.S.records.length === 10, '読み込み時に10件に切り詰める');
  const down = (x) => fireDoc('pointerdown', { clientX: x, clientY: 600, pointerId: 1, pointerType: 'touch', button: 0, target: { closest: () => null } });
  const up = (x) => fireDoc('pointerup', { clientX: x, clientY: 600, pointerId: 1 });
  down(190); api.advance(0.2); up(190); api.advance(12);
  ok(api.state === 4 && api.S.records.length === 10 && api.S.records.every((r, i, a) => i === 0 || a[i - 1].s >= r.s), 'ラウンド後も10件のまま、得点順に並ぶ');
  api.openRecords();
  ok(get('records').classList.contains('open') && get('recList').children.length === 10 && String(get('sumPlays').textContent) === '1', '記録のシートに10行と累計が出る');
}

console.log(`\n${pass} OK / ${fail} NG`);
process.exit(fail ? 1 : 0);
