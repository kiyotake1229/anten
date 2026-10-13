// 暗転: 営業・ポートフォリオ用の短い動画「最初の10秒」を作る
// 使い方: node tools/make-promo.mjs（要 Node.js 22 以降と Google Chrome。ほかに入れるものは無い）
// 出力: 資料/暗転_最初の10秒.png（APNG。ブラウザ・Mac のプレビュー・Slack でそのまま動く）
//       資料/暗転_最初の10秒.webm（動画。Chrome の MediaRecorder で作る。作れなければとばす）
// しくみ: 画面なしの Chrome でアプリを開き、実時間の描画ループを止めて、内部時間を 1/15 秒ずつ進めながら
// 「人のような指」（移り列が見えたら触れて動き、2列抜けたら離す）を合成して1コマずつ撮る
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '資料');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FPS = 15, SECONDS = 11, W = 390, H = 844, DPR = 1.5;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- アプリのフォルダを配る小さな Web サーバー（コマの再生用に一時フォルダも配る） ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anten-promo-'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = u.startsWith('/__tmp/') ? path.join(tmp, u.slice(7)) : path.join(root, u);
  if (!(file.startsWith(root) || file.startsWith(tmp)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---- Chrome を画面なしで起動し、DevTools Protocol につなぐ ----
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'anten-promo-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--force-color-profile=srgb', '--mute-audio', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
let port = null;
for (let i = 0; i < 150 && !port; i++) { try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { await sleep(100); } }
if (!port) throw new Error('Chrome を起動できませんでした（CHROME で場所を指定できます）');
const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0; const pending = new Map(), waiters = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } else if (m.method && waiters.has(m.method)) { waiters.get(m.method)(m.params); waiters.delete(m.method); } };
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const once = method => new Promise(r => waiters.set(method, r));
const evalJs = async (expression, awaitPromise = false) => { const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
await send('Page.enable');

// ---- 「人のような指」。アプリの中で動く ----
const CONTROLLER = `
window.__promo = (() => {
  const a = window.__anten, cv = document.getElementById('c'), v = a.view;
  const toCss = lx => lx * v.SC + v.OX;
  const ev = (t, lx) => cv.dispatchEvent(new PointerEvent(t, { clientX: toCss(lx), clientY: v.PY * v.SC + v.OY + 120, pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true, cancelable: true, button: 0 }));
  const gain = a.S.settings.gain;
  let down = false, fx = 180, target = null, passedAtDown = 0, holdT = 0, t = 0, lastUp = -9;
  const next = () => { for (const r of a.rows) if (!r.passed) return r; return null; };
  function tick(dt) {
    t += dt;
    const r = next();
    if (a.state === 2 && r) {
      if (!down) {
        const needMove = Math.abs(r.gapX - a.player.x) > 14, visible = r.y > v.FY + 10, rested = (a.G.passed === 0 ? t > 1.4 : a.fxTime - a.G.prevPassTime > .18) && t - lastUp > .4; // 離してから間を空ける（薄目にならないように）
        if ((needMove || a.G.passed >= 2) && visible && rested) { fx = 180; ev('pointerdown', fx); down = true; target = r.gapX; passedAtDown = a.G.passed; holdT = 0; }
      } else {
        holdT += dt;
        if (a.G.passed > passedAtDown && next()) target = next().gapX;  // 抜けたら次の隙間を狙う（閉じたまま）
        const d = target - a.player.tx, step = Math.sign(d) * Math.min(Math.abs(d), 260 * dt);
        if (Math.abs(d) > 1) { fx += step / gain; ev('pointermove', fx); }
        const done = a.G.passed - passedAtDown >= 2 || (a.G.passed - passedAtDown >= 1 && next() && next().kind === 'STAY' && holdT > .9);
        if (done || holdT > 2.6) { ev('pointerup', fx); down = false; lastUp = t; }
      }
    } else if (a.state === 0 && t > 1.4) { fx = 180; ev('pointerdown', fx); a.advance(.03); down = true; target = 180; passedAtDown = 0; holdT = 0; }
    a.advance(dt);
    return { t, state: a.state, score: a.G.score, eye: a.eye.mode, down };
  }
  return { tick };
})(); 'ready'`;

// ---- 撮影 ----
const frames = [];
try {
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url: `${base}/index.html` });
  await loaded;
  await sleep(400);
  // 音を消し、実時間の描画ループを止める（内部時間だけで進める）
  await evalJs(`(() => { const a = window.__anten; a.S.settings.sound = false; a.S.settings.vibe = false; window.requestAnimationFrame = () => 0; return 'ok'; })()`);
  await sleep(100);
  await evalJs(CONTROLLER);
  const n = FPS * SECONDS;
  let last = null;
  for (let i = 0; i < n; i++) {
    last = await evalJs(`window.__promo.tick(${1 / FPS})`);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    frames.push(Buffer.from(shot.data, 'base64'));
    if (i % 15 === 0) console.log(`${(i / FPS).toFixed(1)}s  state=${last.state} score=${last.score} eye=${last.eye} ${last.down ? '●' : '○'}`);
  }
  console.log(`${frames.length} コマ撮った（最後: score=${last.score}）`);

  // ---- APNG を組み立てる ----
  fs.mkdirSync(outDir, { recursive: true });
  const apng = buildApng(frames, FPS);
  const apngFile = path.join(outDir, '暗転_最初の10秒.png');
  fs.writeFileSync(apngFile, apng);
  console.log(`${path.relative(root, apngFile)}  ${(apng.length / 1024 / 1024).toFixed(1)} MB`);

  // ---- 絵コンテ（4コマを横に並べた1枚。ポートフォリオ用） ----
  try {
    const picks = [Math.round(FPS * 1.0), Math.round(FPS * 1.9), Math.round(FPS * 2.6), Math.round(FPS * 4.2)].map(i => Math.min(i, frames.length - 1));
    picks.forEach((i, k) => fs.writeFileSync(path.join(tmp, `s${k}.png`), frames[i]));
    const sb = `<!doctype html><canvas id="c"></canvas><script>
      window.board = async (n, w, h) => {
        const imgs = await Promise.all(Array.from({ length: n }, (_, i) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = '/__tmp/s' + i + '.png'; })));
        const gap = 24, c = document.getElementById('c'); c.width = n * w + (n + 1) * gap; c.height = h + 2 * gap; const g = c.getContext('2d');
        g.fillStyle = '#F3EFE6'; g.fillRect(0, 0, c.width, c.height);
        imgs.forEach((im, i) => { g.drawImage(im, gap + i * (w + gap), gap, w, h); });
        return c.toDataURL('image/jpeg', 0.9).split(',')[1];
      };
    </script>`;
    fs.writeFileSync(path.join(tmp, 'board.html'), sb);
    const loadedB = once('Page.loadEventFired');
    await send('Emulation.setDeviceMetricsOverride', { width: 2000, height: 1400, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `${base}/__tmp/board.html` });
    await loadedB;
    const jb = await evalJs(`window.board(${picks.length}, ${W * DPR}, ${H * DPR})`, true);
    const boardFile = path.join(outDir, '暗転_最初の10秒_絵コンテ.jpg');
    fs.writeFileSync(boardFile, Buffer.from(jb, 'base64'));
    console.log(`${path.relative(root, boardFile)}  4コマ（1.0s / 1.9s / 2.6s / 4.2s）`);
  } catch (e) { console.log('絵コンテは作れなかった: ' + e.message); }

  // ---- WebM（コマを実時間で再生しながら録画する） ----
  try {
    frames.forEach((b, i) => fs.writeFileSync(path.join(tmp, `f${i}.png`), b));
    const rec = `<!doctype html><canvas id="c"></canvas><script>
      window.record = async (n, fps, w, h) => {
        const c = document.getElementById('c'); c.width = w; c.height = h; const g = c.getContext('2d');
        const imgs = await Promise.all(Array.from({ length: n }, (_, i) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = '/__tmp/f' + i + '.png'; })));
        g.drawImage(imgs[0], 0, 0);
        const stream = c.captureStream(fps), chunks = [];
        const mr = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 4000000 });
        mr.ondataavailable = e => chunks.push(e.data);
        const done = new Promise(r => { mr.onstop = r; });
        mr.start();
        let i = 0; const t0 = performance.now();
        await new Promise(r => { const f = () => { const k = Math.min(n - 1, Math.floor((performance.now() - t0) / 1000 * fps)); while (i <= k) { g.drawImage(imgs[i], 0, 0); i++; } if (k >= n - 1) r(); else requestAnimationFrame(f); }; requestAnimationFrame(f); });
        await new Promise(r => setTimeout(r, 300)); mr.stop(); await done;
        const blob = new Blob(chunks, { type: 'video/webm' });
        const buf = await blob.arrayBuffer(); let s = ''; const u8 = new Uint8Array(buf); for (let j = 0; j < u8.length; j += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(j, j + 0x8000));
        return btoa(s);
      };
    </script>`;
    fs.writeFileSync(path.join(tmp, 'rec.html'), rec);
    const loaded2 = once('Page.loadEventFired');
    await send('Emulation.setDeviceMetricsOverride', { width: W * DPR, height: H * DPR, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `${base}/__tmp/rec.html` });
    await loaded2;
    const b64 = await evalJs(`window.record(${frames.length}, ${FPS}, ${W * DPR}, ${H * DPR})`, true);
    const webm = Buffer.from(b64, 'base64');
    const webmFile = path.join(outDir, '暗転_最初の10秒.webm');
    fs.writeFileSync(webmFile, webm);
    console.log(`${path.relative(root, webmFile)}  ${(webm.length / 1024 / 1024).toFixed(1)} MB`);
  } catch (e) { console.log('WebM は作れなかった（APNG だけ）: ' + e.message); }
} finally {
  ws.close(); chrome.kill(); server.close(); await sleep(300);
  fs.rmSync(profile, { recursive: true, force: true }); fs.rmSync(tmp, { recursive: true, force: true });
}

// ---- PNG のコマをつないで APNG にする ----
function buildApng(pngs, fps) {
  const CRC = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; }
  const crc32 = buf => { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'latin1'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const parse = png => { const chunks = []; let p = 8; while (p < png.length) { const len = png.readUInt32BE(p), type = png.toString('latin1', p + 4, p + 8); chunks.push({ type, data: png.subarray(p + 8, p + 8 + len) }); p += 12 + len; } return chunks; };
  const first = parse(pngs[0]);
  const ihdr = first.find(c => c.type === 'IHDR').data;
  const idat = chunks => Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => c.data));
  const out = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr)];
  const actl = Buffer.alloc(8); actl.writeUInt32BE(pngs.length, 0); actl.writeUInt32BE(0, 4); out.push(chunk('acTL', actl));
  let seqNo = 0;
  const fctl = () => { const b = Buffer.alloc(26); b.writeUInt32BE(seqNo++, 0); b.writeUInt32BE(ihdr.readUInt32BE(0), 4); b.writeUInt32BE(ihdr.readUInt32BE(4), 8); b.writeUInt32BE(0, 12); b.writeUInt32BE(0, 16); b.writeUInt16BE(1, 20); b.writeUInt16BE(fps, 22); b[24] = 0; b[25] = 0; return chunk('fcTL', b); };
  pngs.forEach((png, i) => {
    const ch = i === 0 ? first : parse(png);
    const ih = ch.find(c => c.type === 'IHDR').data;
    if (!ih.equals(ihdr)) throw new Error('コマの大きさ・形式がそろっていません');
    out.push(fctl());
    const data = idat(ch);
    if (i === 0) out.push(chunk('IDAT', data));
    else { const sq = Buffer.alloc(4); sq.writeUInt32BE(seqNo++); out.push(chunk('fdAT', Buffer.concat([sq, data]))); }
  });
  out.push(chunk('IEND', Buffer.alloc(0)));
  void zlib; // IDAT はそのまま使う（再圧縮しない）
  return Buffer.concat(out);
}
