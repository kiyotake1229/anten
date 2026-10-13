// 暗転: App Store 用のスクリーンショットを作る（見出し入り・5場面 × 4サイズ）。凪の池の仕組みを流用
// 使い方: node tools/make-screenshots.mjs（要 Node.js 22 以降と Google Chrome。ほかに入れるものは無い）
// 出力: ios-app/screenshots/<端末>/<番号>-<場面>.jpg
// しくみ: この中で小さな Web サーバーを立て、Chrome を画面なしで起動して tools/screenshot-frame.html を
// 端末の大きさ・タッチ操作の設定で開き、場面ごとにアプリを操作してから撮る
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'ios-app', 'screenshots');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// App Store Connect で求められる大きさ（w × h × dpr が画像のピクセル数）。
// iw / ih はアプリが使える領域（上のステータスバーと下のホームバーを除いた大きさ）
const DEVICES = [
  { name: 'iphone-6.9', w: 440, h: 956, dpr: 3, iw: 440, ih: 956 - 62 - 34 },
  { name: 'iphone-6.5', w: 428, h: 926, dpr: 3, iw: 428, ih: 926 - 44 - 34 },
  { name: 'iphone-5.5', w: 414, h: 736, dpr: 3, iw: 414, ih: 736 - 20 },
  { name: 'ipad-13', w: 1032, h: 1376, dpr: 2, iw: 1032, ih: 1376 - 24 - 20 },
];
const SCENES = ['title', 'open', 'dark', 'result', 'daily'];

// ---- アプリのフォルダを配る小さな Web サーバー ----
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---- Chrome を画面なしで起動し、開発者用の通信口（DevTools Protocol）につなぐ ----
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'anten-shots-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-color-profile=srgb', '--mute-audio', 'about:blank'], { stdio: 'ignore' });
let port = null;
for (let i = 0; i < 150 && !port; i++) {
  try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { await sleep(100); }
}
if (!port) throw new Error('Chrome を起動できませんでした（CHROME で場所を指定できます）');
const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const pending = new Map(), waiters = new Map();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
    m.error ? reject(new Error(m.error.message)) : resolve(m.result);
  } else if (m.method && waiters.has(m.method)) {
    waiters.get(m.method)(m.params); waiters.delete(m.method);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const once = method => new Promise(r => waiters.set(method, r));
await send('Page.enable');

// ---- 撮影 ----
try {
  for (const d of DEVICES) {
    fs.mkdirSync(path.join(outDir, d.name), { recursive: true });
    await send('Emulation.setDeviceMetricsOverride', { width: d.w, height: d.h, deviceScaleFactor: d.dpr, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    for (const [i, scene] of SCENES.entries()) {
      const loaded = once('Page.loadEventFired');
      await send('Page.navigate', { url: `${base}/tools/screenshot-frame.html?iw=${d.iw}&ih=${d.ih}` });
      await loaded;
      const r = await send('Runtime.evaluate', { expression: `setupScene('${scene}')`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`${d.name} ${scene}: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
      const file = path.join(outDir, d.name, `${i + 1}-${scene}.jpg`);
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      console.log(`${path.relative(root, file)}  ${d.w * d.dpr}×${d.h * d.dpr}  ${JSON.stringify(r.result.value)}`);
    }
  }
} finally {
  ws.close();
  chrome.kill();
  server.close();
  await sleep(300);
  fs.rmSync(profile, { recursive: true, force: true }); // この中で作った Chrome の一時フォルダだけを消す
}
