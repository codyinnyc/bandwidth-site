'use client';

import { useEffect, useRef, useState } from 'react';

const MB = 1_000_000;
const CHUNK = 10 * MB;
const DOWN = 'https://speed.cloudflare.com/__down';
const UP = 'https://speed.cloudflare.com/__up';

type Direction = 'download' | 'upload' | 'both';
type Tone = '' | 'live' | 'error';
type Transfer = { direction: 'download' | 'upload'; bytes: number };
type Snapshot = { downloaded: number; uploaded: number; rate: number; elapsed: number; requests: number; edge: string };

const freshSnapshot = (): Snapshot => ({ downloaded: 0, uploaded: 0, rate: 0, elapsed: 0, requests: 0, edge: '—' });
const formatBytes = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / MB).toFixed(bytes >= 10 * MB ? 1 : 2)} MB`;
const formatRate = (bytes: number) => `${(bytes / MB).toFixed(bytes >= 10 * MB ? 1 : 2)} MB/s`;
const formatTime = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export default function Home() {
  const [direction, setDirection] = useState<Direction>('download');
  const [size, setSize] = useState('1000');
  const [connections, setConnections] = useState(4);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<{ label: string; message: string; tone: Tone }>({ label: 'IDLE', message: 'Choose a workload and start the transfer.', tone: '' });
  const [snapshot, setSnapshot] = useState<Snapshot>(freshSnapshot);
  const runtime = useRef({
    running: false, active: new Map<symbol, Transfer>(), completedDown: 0, completedUp: 0,
    planned: 0, requests: 0, started: 0, target: 0, samples: [] as { at: number; total: number }[],
    controllers: new Set<AbortController>(), xhrs: new Set<XMLHttpRequest>(), timer: 0 as ReturnType<typeof setInterval> | 0,
    blobs: new Map<number, Blob>(), edge: '—',
  });

  const totals = () => {
    let downloaded = runtime.current.completedDown;
    let uploaded = runtime.current.completedUp;
    runtime.current.active.forEach((transfer) => transfer.direction === 'download' ? downloaded += transfer.bytes : uploaded += transfer.bytes);
    return { downloaded, uploaded, total: downloaded + uploaded };
  };

  const render = () => {
    const now = performance.now();
    const current = totals();
    const samples = runtime.current.samples;
    samples.push({ at: now, total: current.total });
    while (samples.length > 1 && samples[0].at < now - 1500) samples.shift();
    const oldest = samples[0];
    const rate = oldest && now > oldest.at ? (current.total - oldest.total) / ((now - oldest.at) / 1000) : 0;
    setSnapshot({ downloaded: current.downloaded, uploaded: current.uploaded, rate, elapsed: runtime.current.started ? now - runtime.current.started : 0, requests: runtime.current.requests, edge: runtime.current.edge });
  };

  const halt = (message = 'Transfer stopped. Partial totals are preserved.', tone: Tone = '') => {
    const rt = runtime.current;
    if (!rt.running && !running) return;
    rt.running = false;
    if (rt.timer) clearInterval(rt.timer);
    rt.timer = 0;
    rt.active.forEach((transfer) => transfer.direction === 'download' ? rt.completedDown += transfer.bytes : rt.completedUp += transfer.bytes);
    rt.active.clear();
    rt.controllers.forEach((controller) => controller.abort());
    rt.xhrs.forEach((xhr) => xhr.abort());
    rt.controllers.clear(); rt.xhrs.clear();
    render(); setRunning(false); setStatus({ label: tone === 'error' ? 'ERROR' : 'STOPPED', message, tone });
  };

  const reserve = () => {
    const rt = runtime.current;
    if (!rt.target) return CHUNK;
    const remaining = rt.target - rt.planned;
    if (remaining <= 0) return 0;
    const bytes = Math.min(CHUNK, remaining);
    rt.planned += bytes;
    return bytes;
  };

  const download = async (bytes: number, id: symbol) => {
    const controller = new AbortController(); runtime.current.controllers.add(controller);
    try {
      const response = await fetch(`${DOWN}?bytes=${bytes}&r=${crypto.randomUUID()}`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`Download endpoint returned ${response.status}.`);
      runtime.current.edge = response.headers.get('cf-meta-colo') || response.headers.get('cf-ray')?.split('-')[1] || runtime.current.edge;
      const reader = response.body.getReader();
      while (runtime.current.running) {
        const { done, value } = await reader.read();
        if (done) break;
        const transfer = runtime.current.active.get(id); if (transfer) transfer.bytes += value.byteLength;
      }
    } finally { runtime.current.controllers.delete(controller); }
  };

  const upload = (bytes: number, id: symbol) => new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest(); runtime.current.xhrs.add(xhr);
    xhr.open('POST', `${UP}?r=${crypto.randomUUID()}`);
    xhr.upload.onprogress = (event) => { const transfer = runtime.current.active.get(id); if (transfer) transfer.bytes = event.loaded; };
    xhr.onload = () => {
      runtime.current.xhrs.delete(xhr);
      runtime.current.edge = xhr.getResponseHeader('cf-meta-colo') || xhr.getResponseHeader('cf-ray')?.split('-')[1] || runtime.current.edge;
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload endpoint returned ${xhr.status}.`));
    };
    xhr.onerror = () => { runtime.current.xhrs.delete(xhr); reject(new Error('Upload connection failed.')); };
    xhr.onabort = () => { runtime.current.xhrs.delete(xhr); resolve(); };
    let body = runtime.current.blobs.get(bytes);
    if (!body) { body = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }); runtime.current.blobs.set(bytes, body); }
    xhr.send(body);
  });

  const worker = async (index: number, selected: Direction) => {
    let turn: 'download' | 'upload' = selected === 'both' ? (index % 2 ? 'upload' : 'download') : selected;
    while (runtime.current.running) {
      const bytes = reserve(); if (!bytes) break;
      const id = Symbol(); runtime.current.active.set(id, { direction: turn, bytes: 0 });
      try { turn === 'download' ? await download(bytes, id) : await upload(bytes, id); }
      catch (error) { if (runtime.current.running) throw error; }
      const transfer = runtime.current.active.get(id);
      if (transfer) {
        transfer.direction === 'download' ? runtime.current.completedDown += transfer.bytes : runtime.current.completedUp += transfer.bytes;
        runtime.current.active.delete(id); runtime.current.requests += 1;
      }
      if (selected === 'both') turn = turn === 'download' ? 'upload' : 'download';
    }
  };

  const start = async () => {
    const amount = Number(size);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000 || !Number.isInteger(amount)) {
      setStatus({ label: 'CHECK', message: 'Enter a whole number from 0 to 1,000,000 MB.', tone: 'error' }); return;
    }
    const rt = runtime.current;
    rt.running = true; rt.active.clear(); rt.completedDown = 0; rt.completedUp = 0; rt.planned = 0; rt.requests = 0;
    rt.started = performance.now(); rt.target = amount * MB; rt.samples = []; rt.edge = '—';
    setSnapshot(freshSnapshot()); setRunning(true);
    setStatus({ label: 'LIVE', message: amount === 0 ? 'Continuous mode — stop whenever you are finished.' : `Transferring ${amount.toLocaleString()} MB through Cloudflare.`, tone: 'live' });
    rt.timer = setInterval(render, 200);
    try {
      await Promise.all(Array.from({ length: connections }, (_, index) => worker(index, direction)));
      if (rt.running && rt.target) {
        rt.running = false; if (rt.timer) clearInterval(rt.timer); rt.timer = 0; render(); setRunning(false);
        setStatus({ label: 'DONE', message: 'Transfer complete.', tone: '' });
      }
    } catch (error) { halt(error instanceof Error ? error.message : 'Transfer failed.', 'error'); }
  };

  useEffect(() => () => {
    const rt = runtime.current; rt.running = false; if (rt.timer) clearInterval(rt.timer);
    rt.controllers.forEach((controller) => controller.abort()); rt.xhrs.forEach((xhr) => xhr.abort());
  }, []);

  const target = Number(size) * MB;
  const total = snapshot.downloaded + snapshot.uploaded;
  const downWidth = target > 0 ? Math.min(100, snapshot.downloaded / target * 100) : total ? snapshot.downloaded / total * 100 : 0;
  const upWidth = target > 0 ? Math.min(100, snapshot.uploaded / target * 100) : total ? snapshot.uploaded / total * 100 : 0;

  return <>
    <header className="shell masthead"><a className="brand" href="#top"><span className="brand-mark" aria-hidden="true"><i/><i/><i/></span>Bandwidth Lab</a><span className="mode"><span className="mode-dot"/>Cloudflare edge</span></header>
    <main id="top" className="shell">
      <section className="hero"><p className="eyebrow">// CONTROLLED NETWORK LOAD</p><h1>Use the bandwidth.<br/><em>See every byte.</em></h1><p className="lede">A configurable transfer utility for testing your own connection. Choose a direction, set the workload, and watch throughput at the browser in real time.</p></section>
      <section className="console">
        <div className="controls">
          <div className="control-group"><span className="control-label">Transfer direction</span><div className="segmented" role="radiogroup" aria-label="Transfer direction">
            {(['download','upload','both'] as Direction[]).map((item) => <button key={item} type="button" role="radio" aria-checked={direction === item} disabled={running} onClick={() => setDirection(item)}>{item[0].toUpperCase()+item.slice(1)}</button>)}
          </div></div>
          <div className="control-row">
            <label className="field"><span className="control-label">Data allowance</span><span className="number-control"><input type="number" min="0" max="1000000" step="1" value={size} disabled={running} onChange={(event) => setSize(event.target.value)}/><span>MB</span></span><small>Set 0 for continuous mode</small></label>
            <label className="field"><span className="control-label">Connections · {connections}</span><input type="range" min="1" max="16" value={connections} disabled={running} onChange={(event) => setConnections(Number(event.target.value))}/><small>Parallel browser requests</small></label>
          </div>
          <button className={`run-button${running ? ' running' : ''}`} type="button" onClick={running ? () => halt() : start}><span>{running ? 'Stop transfer' : 'Start transfer'}</span><span className="run-icon" aria-hidden="true">{running ? '■' : '→'}</span></button>
          <p className="safety-note">Large or continuous tests can consume significant metered data.</p>
          <p className="endpoint-note"><span>●</span> Destination <strong>speed.cloudflare.com</strong></p>
        </div>
        <div className="telemetry" aria-live="polite">
          <div className="status-line"><span className={`status-chip ${status.tone}`}>{status.label}</span><span>{status.message}</span></div>
          <div className="primary-reading"><span className="reading-value">{(snapshot.rate / MB).toFixed(snapshot.rate >= 10 * MB ? 1 : 2)}</span><span className="reading-unit">MB/s</span></div><p className="reading-label">Current combined transfer rate</p>
          <div className="meter" aria-label={`${formatBytes(total)} transferred`}><span className="download-fill" style={{width:`${downWidth}%`}}/><span className="upload-fill" style={{width:`${upWidth}%`}}/></div>
          <dl className="stats"><div><dt><span className="legend download"/>Downloaded</dt><dd>{formatBytes(snapshot.downloaded)}</dd></div><div><dt><span className="legend upload"/>Uploaded</dt><dd>{formatBytes(snapshot.uploaded)}</dd></div><div><dt>Total used</dt><dd>{formatBytes(total)}</dd></div></dl>
          <div className="run-details"><span>ELAPSED {formatTime(snapshot.elapsed)}</span><span>REQUESTS {snapshot.requests}</span><span>EDGE {snapshot.edge}</span><span>AVG {snapshot.elapsed ? formatRate(total / (snapshot.elapsed / 1000)) : '0.00 MB/s'}</span></div>
        </div>
      </section>
    </main>
    <footer className="shell"><span>Bandwidth Lab / browser-side transfers</span><span>No test payloads are stored by this site.</span></footer>
  </>;
}
