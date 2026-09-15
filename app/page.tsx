'use client';

import { useEffect, useRef, useState } from 'react';
import WakeControl from './wake-control';
import AmbientDisplay from './ambient-display';

const MB = 1_000_000;
const CHUNK = 10 * MB;
const DOWN = 'https://speed.cloudflare.com/__down';
const UP = 'https://speed.cloudflare.com/__up';
type Direction = 'download' | 'upload' | 'both';
type Unit = 'Mbps' | 'MB/s';
type Transfer = { direction: 'download' | 'upload'; bytes: number };
type Point = { at: number; rate: number };
type Snapshot = { downloaded: number; uploaded: number; downloadRate: number; uploadRate: number; rate: number; elapsed: number; requests: number; edge: string; points: Point[] };
const freshSnapshot = (): Snapshot => ({ downloaded: 0, uploaded: 0, downloadRate: 0, uploadRate: 0, rate: 0, elapsed: 0, requests: 0, edge: '—', points: [] });
const newRun = () => ({
  running: false, active: new Map<symbol, Transfer>(), completedDown: 0, completedUp: 0,
  planned: 0, requests: 0, started: 0, target: 0, samples: [] as { at: number; downloaded: number; uploaded: number }[], points: [] as Point[],
  controllers: new Set<AbortController>(), xhrs: new Set<XMLHttpRequest>(), timer: 0 as ReturnType<typeof setInterval> | 0,
  blobs: new Map<number, Blob>(), edge: '—',
});
type Run = ReturnType<typeof newRun>;
const formatBytes = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / MB).toFixed(bytes >= 10 * MB ? 1 : 2)} MB`;
const rateValue = (bytes: number, unit: Unit) => bytes / MB * (unit === 'Mbps' ? 8 : 1);
const formatRate = (bytes: number, unit: Unit) => rateValue(bytes, unit).toFixed(1);
const formatTime = (ms: number) => ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m ${Math.floor(ms / 1000) % 60}s`;
const totals = (rt: Run) => {
  let downloaded = rt.completedDown, uploaded = rt.completedUp;
  rt.active.forEach((transfer) => transfer.direction === 'download' ? downloaded += transfer.bytes : uploaded += transfer.bytes);
  return { downloaded, uploaded, total: downloaded + uploaded };
};
const cancel = (rt: Run) => {
  rt.running = false;
  if (rt.timer) clearInterval(rt.timer);
  rt.timer = 0;
  rt.active.forEach((transfer) => transfer.direction === 'download' ? rt.completedDown += transfer.bytes : rt.completedUp += transfer.bytes);
  rt.active.clear();
  rt.controllers.forEach((controller) => controller.abort());
  rt.xhrs.forEach((xhr) => xhr.abort());
  rt.controllers.clear(); rt.xhrs.clear(); rt.blobs.clear();
};

function Icon({ name }: { name: 'down' | 'up' | 'both' | 'play' | 'stop' | 'arrow' | 'signal' }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'down' && <path d="M12 4v16m-6-6 6 6 6-6"/>}
    {name === 'up' && <path d="M12 20V4m-6 6 6-6 6 6"/>}
    {name === 'both' && <path d="M7 4v16m-4-4 4 4 4-4M17 20V4m-4 4 4-4 4 4"/>}
    {name === 'play' && <path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none"/>}
    {name === 'stop' && <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>}
    {name === 'arrow' && <path d="M7 17 17 7M7 7h10v10"/>}
    {name === 'signal' && <><path d="M4 17v3m5-8v8m6-13v13m5-18v18"/></>}
  </svg>;
}

function RateChart({ points, unit, running }: { points: Point[]; unit: Unit; running: boolean }) {
  const maximum = Math.max(1, ...points.map((point) => rateValue(point.rate, unit))) * 1.15;
  const ceiling = Math.ceil(maximum / (maximum > 100 ? 100 : maximum > 10 ? 10 : 1)) * (maximum > 100 ? 100 : maximum > 10 ? 10 : 1);
  const end = points.at(-1)?.at || 0;
  const start = Math.max(0, end - 30);
  const coordinates = points.filter((point) => point.at >= start).map((point) => `${((point.at - start) / 30 * 600).toFixed(2)},${(130 - rateValue(point.rate, unit) / ceiling * 118).toFixed(2)}`);
  const path = coordinates.length ? `M${coordinates.join(' L')}` : '';
  return <div className="chart" role="img" aria-label={points.length ? `Combined throughput over the last ${Math.min(30, Math.ceil(end))} seconds. Peak in chart: ${formatRate(Math.max(...points.map(p => p.rate)), unit)} ${unit}.` : 'Throughput graph. Start a transfer to see live measurements.'}>
    <div className="chart-scale"><span>{ceiling} {unit}</span><span>0</span></div>
    <svg viewBox="0 0 600 145" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="chart-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#64a8ff" stopOpacity=".24"/><stop offset="100%" stopColor="#64a8ff" stopOpacity="0"/></linearGradient></defs>
      {[12, 51, 90, 130].map(y => <line key={y} x1="0" x2="600" y1={y} y2={y} className="chart-grid"/>)}
      {path && <><path d={`${path} L${coordinates.at(-1)?.split(',')[0]},130 L${coordinates[0]?.split(',')[0]},130 Z`} fill="url(#chart-area)"/><path d={path} fill="none" stroke="#79b7ff" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round"/></>}
    </svg>
    {!points.length && <span className="chart-empty">Your connection, in real time.</span>}
    <div className="chart-axis"><span>{start.toFixed(0)}s</span><span>{running ? 'Live · ' : ''}30-second window</span><span>{(start + 30).toFixed(0)}s</span></div>
  </div>;
}

export default function Home() {
  const [direction, setDirection] = useState<Direction>('download');
  const [size, setSize] = useState('100');
  const continuous = !size.trim() || Number(size) === 0;
  const [advanced, setAdvanced] = useState(false);
  const [downloadThreads, setDownloadThreads] = useState(2);
  const [uploadThreads, setUploadThreads] = useState(2);
  const [connections, setConnections] = useState(4);
  const [unit, setUnit] = useState<Unit>('Mbps');
  const [running, setRunning] = useState(false);
  const [keepAwake, setKeepAwake] = useState(false);
  const [status, setStatus] = useState({ label: 'Ready', message: 'Set your transfer, then press start.', tone: '' });
  const [snapshot, setSnapshot] = useState<Snapshot>(freshSnapshot);
  const runtime = useRef<Run>(newRun());
  const [runTarget, setRunTarget] = useState<number | null>(null);

  const render = (rt: Run) => {
    if (runtime.current !== rt) return;
    const now = performance.now(), current = totals(rt);
    rt.samples.push({ at: now, downloaded: current.downloaded, uploaded: current.uploaded });
    // Keep the sample just before the window boundary for a stable rolling rate.
    while (rt.samples.length > 2 && rt.samples[1].at < now - 1500) rt.samples.shift();
    const oldest = rt.samples[0];
    const seconds = oldest && now > oldest.at ? (now - oldest.at) / 1000 : 0;
    const downloadRate = rt.running && seconds ? Math.max(0, (current.downloaded - oldest.downloaded) / seconds) : 0;
    const uploadRate = rt.running && seconds ? Math.max(0, (current.uploaded - oldest.uploaded) / seconds) : 0;
    const rate = downloadRate + uploadRate;
    const elapsed = now - rt.started;
    rt.points.push({ at: elapsed / 1000, rate });
    while (rt.points.length > 1 && rt.points[0].at < elapsed / 1000 - 30) rt.points.shift();
    setSnapshot({ downloaded: current.downloaded, uploaded: current.uploaded, downloadRate, uploadRate, rate, elapsed, requests: rt.requests, edge: rt.edge, points: [...rt.points] });
  };

  const halt = (rt: Run, message = 'Stopped. Your transferred totals are preserved.', tone = '') => {
    if (runtime.current !== rt || !rt.running) return;
    cancel(rt); render(rt); setRunning(false);
    setStatus({ label: tone === 'error' ? 'Connection issue' : 'Stopped', message, tone });
  };

  const reserve = (rt: Run) => {
    if (!rt.target) return CHUNK;
    const bytes = Math.min(CHUNK, rt.target - rt.planned);
    if (bytes <= 0) return 0;
    rt.planned += bytes;
    return bytes;
  };

  const download = async (rt: Run, bytes: number, id: symbol) => {
    const controller = new AbortController(); rt.controllers.add(controller);
    try {
      const response = await fetch(`${DOWN}?bytes=${bytes}&r=${crypto.randomUUID()}`, { cache: 'no-store', signal: controller.signal });
      if (!response.ok || !response.body) throw new Error(`Download endpoint returned ${response.status}. Try again.`);
      rt.edge = response.headers.get('cf-meta-colo') || response.headers.get('cf-ray')?.split('-')[1] || rt.edge;
      const reader = response.body.getReader();
      while (rt.running) {
        const { done, value } = await reader.read();
        if (done) break;
        const transfer = rt.active.get(id); if (transfer) transfer.bytes += value.byteLength;
      }
      if (rt.running && rt.active.get(id)?.bytes !== bytes) throw new Error('Download ended before the full payload arrived. Try again.');
    } finally { rt.controllers.delete(controller); }
  };

  const upload = (rt: Run, bytes: number, id: symbol) => new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest(); rt.xhrs.add(xhr);
    xhr.open('POST', `${UP}?r=${crypto.randomUUID()}`);
    xhr.timeout = 120000;
    xhr.upload.onprogress = (event) => { const transfer = rt.active.get(id); if (transfer) transfer.bytes = Math.min(bytes, event.loaded); };
    xhr.onload = () => {
      rt.xhrs.delete(xhr);
      rt.edge = xhr.getResponseHeader('cf-meta-colo') || xhr.getResponseHeader('cf-ray')?.split('-')[1] || rt.edge;
      if (xhr.status >= 200 && xhr.status < 300) {
        const transfer = rt.active.get(id); if (transfer) transfer.bytes = bytes;
        resolve();
      } else reject(new Error(`Upload endpoint returned ${xhr.status}. Try again.`));
    };
    xhr.onerror = () => { rt.xhrs.delete(xhr); reject(new Error('Upload connection failed. Check your connection and try again.')); };
    xhr.ontimeout = () => { rt.xhrs.delete(xhr); reject(new Error('Upload timed out. Try fewer connections or a smaller transfer.')); };
    xhr.onabort = () => { rt.xhrs.delete(xhr); resolve(); };
    let body = rt.blobs.get(bytes);
    if (!body) { body = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }); rt.blobs.set(bytes, body); }
    xhr.send(body);
  });

  const worker = async (rt: Run, index: number, selected: Direction) => {
    let turn: 'download' | 'upload' = selected === 'both' ? (index % 2 ? 'upload' : 'download') : selected;
    while (rt.running) {
      const bytes = reserve(rt); if (!bytes) break;
      const id = Symbol(); rt.active.set(id, { direction: turn, bytes: 0 });
      try {
        if (turn === 'download') await download(rt, bytes, id);
        else await upload(rt, bytes, id);
      } catch (error) { if (rt.running) throw error; }
      const transfer = rt.active.get(id);
      if (transfer) {
        if (transfer.direction === 'download') rt.completedDown += transfer.bytes;
        else rt.completedUp += transfer.bytes;
        rt.active.delete(id); rt.requests += 1;
      }
      if (selected === 'both') turn = turn === 'download' ? 'upload' : 'download';
    }
  };

  const start = async () => {
    if (runtime.current.running) return;
    const amount = continuous ? 0 : Number(size);
    if (!Number.isInteger(amount) || amount < 0 || amount > 1_000_000) {
      setStatus({ label: 'Check amount', message: 'Enter a whole number from 0 to 1,000,000 MB. Blank or 0 means unlimited.', tone: 'error' }); return;
    }
    // Each run owns its requests and counters. Settling an aborted request cannot affect a later run.
    const rt = newRun(); runtime.current = rt;
    rt.running = true; rt.started = performance.now(); rt.target = amount * MB;
    rt.samples = [{ at: rt.started, downloaded: 0, uploaded: 0 }]; rt.points = [{ at: 0, rate: 0 }];
    setRunTarget(rt.target); setSnapshot(freshSnapshot()); setRunning(true);
    setStatus({ label: 'Transferring', message: continuous ? 'Continuous transfer. Stop whenever you’re ready.' : `Transferring ${formatBytes(rt.target)} ${direction === 'both' ? 'across both directions' : direction === 'download' ? 'to your browser' : 'from your browser'}.`, tone: 'live' });
    rt.timer = setInterval(() => render(rt), 200);
    try {
      const jobs = advanced
        ? [
            ...(direction !== 'upload' ? Array.from({ length: downloadThreads }, (_, index) => worker(rt, index, 'download')) : []),
            ...(direction !== 'download' ? Array.from({ length: uploadThreads }, (_, index) => worker(rt, index, 'upload')) : []),
          ]
        : Array.from({ length: connections }, (_, index) => worker(rt, index, direction));
      await Promise.all(jobs);
      if (runtime.current === rt && rt.running && rt.target) {
        cancel(rt); render(rt); setRunning(false);
        setStatus({ label: 'Complete', message: 'Transfer finished. Your results are ready.', tone: 'done' });
      }
    } catch (error) { halt(rt, error instanceof Error ? error.message : 'Transfer failed. Try again.', 'error'); }
  };

  useEffect(() => () => cancel(runtime.current), []);

  const total = snapshot.downloaded + snapshot.uploaded;
  const target = runTarget ?? (continuous ? 0 : Math.max(0, Number(size) || 0) * MB);
  const progress = target ? Math.min(100, total / target * 100) : 0;
  const average = snapshot.elapsed ? total / (snapshot.elapsed / 1000) : 0;
  const hasResult = !running && snapshot.elapsed > 0;

  return <>
    <a className="skip-link" href="#transfer">Skip to transfer controls</a>
    <header className="shell masthead">
      <a className="brand" href="https://cooop.io" aria-label="cooop.io home">cooop<span className="brand-dot">.</span><span className="brand-divider"/><span className="brand-product">Bandwidth Lab</span></a>
      <a className="home-link" href="https://cooop.io">Back to cooop.io <Icon name="arrow"/></a>
    </header>
    <main className="shell">
      <section className="hero" aria-labelledby="page-title">
        <p className="eyebrow"><span className="little-signal"><Icon name="signal"/></span> A little clarity for your connection</p>
        <h1 id="page-title">Every byte.<br/><span>Beautifully clear.</span></h1>
        <p className="lede">Put your connection through its paces.<br className="desktop-break"/> Set a transfer. Watch it move. See what it can do.</p>
        <div className="hero-meta"><span className="quiet-dot"/>Powered by Cloudflare’s speed-test network</div>
      </section>

      <section className="console" aria-label="Bandwidth test">
        <div className="telemetry">
          <div className="panel-heading"><span className="section-label">Connection overview</span><span className={`status-chip ${status.tone}`}><span/>{status.label}</span></div>
          <div className="reading-topline"><span>{hasResult ? 'Average combined throughput' : 'Live combined throughput'}</span><div className="unit-toggle" aria-label="Speed units">{(['Mbps', 'MB/s'] as Unit[]).map(value => <button key={value} type="button" aria-pressed={unit === value} onClick={() => setUnit(value)}>{value}</button>)}</div></div>
          <div className="primary-reading"><span className={`reading-value${!snapshot.elapsed ? ' empty' : ''}`}>{snapshot.elapsed ? formatRate(hasResult ? average : snapshot.rate, unit) : '0.0'}</span><span className="reading-unit">{unit}</span></div>
          <dl className="direction-rates" aria-label={hasResult ? 'Average directional throughput' : 'Current directional throughput'}>
            <div><dt><Icon name="down"/>{hasResult ? 'Average download' : 'Download'}</dt><dd><span>{formatRate(hasResult ? snapshot.downloaded / (snapshot.elapsed / 1000) : snapshot.downloadRate, unit)}</span> <small>{unit}</small></dd></div>
            <div><dt><Icon name="up"/>{hasResult ? 'Average upload' : 'Upload'}</dt><dd><span>{formatRate(hasResult ? snapshot.uploaded / (snapshot.elapsed / 1000) : snapshot.uploadRate, unit)}</span> <small>{unit}</small></dd></div>
          </dl>
          <RateChart points={snapshot.points} unit={unit} running={running}/>
          <dl className="stats">
            <div><dt><span className="download-icon"><Icon name="down"/></span>Downloaded</dt><dd>{formatBytes(snapshot.downloaded)}</dd></div>
            <div><dt><span className="upload-icon"><Icon name="up"/></span>Uploaded</dt><dd>{formatBytes(snapshot.uploaded)}</dd></div>
            <div><dt>Total transferred</dt><dd>{formatBytes(total)}</dd></div>
          </dl>
          <div className="progress-heading"><span>{target ? 'Transfer progress' : 'Continuous transfer'}</span><span>{target ? `${progress.toFixed(0)}%` : 'No data limit'}</span></div>
          <div className={`meter${!target && running ? ' continuous' : ''}`} role="progressbar" aria-label="Transfer progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={target ? Math.round(progress) : undefined}><span style={{ width: `${progress}%` }}/></div>
          <dl className="run-details"><div><dt>Elapsed</dt><dd>{formatTime(snapshot.elapsed)}</dd></div><div><dt>Requests</dt><dd>{snapshot.requests}</dd></div><div><dt>Edge</dt><dd>{snapshot.edge}</dd></div><div><dt>Average</dt><dd>{formatRate(average, unit)} <span>{unit}</span></dd></div></dl>
        </div>

        <div className="controls" id="transfer">
          <div className="controls-title"><h2>Your transfer</h2><p>A quick check or a longer run. You decide.</p></div>
          <fieldset disabled={running}><legend>Direction</legend><div className="segmented" aria-label="Transfer direction">
            {(['download', 'upload', 'both'] as Direction[]).map((item) => <button key={item} type="button" aria-pressed={direction === item} onClick={() => setDirection(item)}><Icon name={item === 'download' ? 'down' : item === 'upload' ? 'up' : 'both'}/>{item === 'both' ? 'Both' : item[0].toUpperCase() + item.slice(1)}</button>)}
          </div><p className="field-help">{direction === 'both' ? 'Shares the total allowance between directions; the split can vary.' : direction === 'download' ? 'Measure data arriving at your browser.' : 'Measure data sent from your browser.'}</p></fieldset>
          <fieldset disabled={running}><legend>Data allowance</legend>
            <div className="presets">{['100', '1000'].map(value => <button key={value} type="button" aria-pressed={!continuous && size === value} onClick={() => setSize(value)}>{value === '100' ? '100 MB' : '1 GB'}</button>)}<button type="button" aria-pressed={continuous} onClick={() => setSize('0')}>Continuous</button></div>
            <label className="number-control"><span className="sr-only">Custom data allowance in megabytes</span><input type="number" inputMode="numeric" min="0" max="1000000" step="1" value={size} disabled={running} placeholder="Unlimited" onChange={(event) => setSize(event.target.value)} aria-describedby="allowance-help"/><span>MB</span></label>
            <p className="field-help" id="allowance-help">{continuous ? 'Unlimited. Runs until you stop. Keep this tab open.' : 'Blank or 0 means unlimited. 1 GB = 1,000 MB.'}</p>
          </fieldset>
          <div className="advanced-toggle"><label htmlFor="advanced-options">Advanced options</label><button id="advanced-options" className="switch" type="button" role="switch" aria-checked={advanced} aria-controls="thread-options" disabled={running} onClick={() => setAdvanced(!advanced)}><span/></button></div>
          <div id="thread-options">
            {advanced ? <fieldset className="thread-settings" disabled={running}><legend className="sr-only">Separate thread counts</legend>
              <label className="thread-field"><span className="connections-label"><span><Icon name="down"/>Download threads</span><span className="count-badge">{downloadThreads}</span></span><input type="range" aria-label="Download threads" min="1" max="16" value={downloadThreads} disabled={running || direction === 'upload'} style={{ '--range-progress': `${(downloadThreads - 1) / 15 * 100}%` } as React.CSSProperties} onChange={(event) => setDownloadThreads(Number(event.target.value))}/></label>
              <label className="thread-field"><span className="connections-label"><span><Icon name="up"/>Upload threads</span><span className="count-badge">{uploadThreads}</span></span><input type="range" aria-label="Upload threads" min="1" max="16" value={uploadThreads} disabled={running || direction === 'download'} style={{ '--range-progress': `${(uploadThreads - 1) / 15 * 100}%` } as React.CSSProperties} onChange={(event) => setUploadThreads(Number(event.target.value))}/></label>
              <p className="field-help">{direction === 'both' ? `${downloadThreads + uploadThreads} threads total. Each direction uses its own pool and shares the data allowance.` : `Choose Both to use both pools. ${direction === 'download' ? 'Upload' : 'Download'} threads are inactive.`}</p>
            </fieldset> : <fieldset disabled={running}><legend className="connections-label"><span>Connections</span><span className="count-badge">{connections}</span></legend><label><span className="sr-only">Parallel connections</span><input type="range" min="1" max="16" value={connections} style={{ '--range-progress': `${(connections - 1) / 15 * 100}%` } as React.CSSProperties} onChange={(event) => setConnections(Number(event.target.value))}/></label><div className="range-labels"><span>1 · Lighter load</span><span>16 · More parallel</span></div></fieldset>}
          </div>
          <WakeControl running={running} enabled={keepAwake} onEnabledChange={setKeepAwake}/>
          {keepAwake && running && <AmbientDisplay downloadRate={formatRate(snapshot.downloadRate, 'Mbps')} uploadRate={formatRate(snapshot.uploadRate, 'Mbps')} combinedRate={formatRate(snapshot.rate, 'Mbps')} downloaded={formatBytes(snapshot.downloaded)} uploaded={formatBytes(snapshot.uploaded)} transferred={formatBytes(total)} onStop={() => halt(runtime.current)}/>}
          <button className={`run-button${running ? ' running' : ''}`} type="button" onClick={running ? () => halt(runtime.current) : start}><Icon name={running ? 'stop' : 'play'}/>{running ? 'Stop transfer' : hasResult ? 'Run again' : 'Start transfer'}</button>
          <p className={`status-message ${status.tone}`} role="status" aria-live="polite">{status.message}</p>
          <p className="data-note">Uses real data. Large transfers may count toward your plan’s data allowance.</p>
        </div>
      </section>
      <section className="details-strip" aria-label="About this test"><div><span className="detail-number">01</span><h2>Direct by design.</h2><p>Test traffic travels between your browser and Cloudflare.</p></div><div><span className="detail-number">02</span><h2>Your pace. Your control.</h2><p>Adjust the workload and stop at any point. No automatic runs.</p></div><div><span className="detail-number">03</span><h2>A clearer measurement.</h2><p>Live payload throughput, not a full connection-quality score.</p></div></section>
    </main>
    <footer className="shell"><span>A small utility by <a href="https://cooop.io">cooop.</a></span><span>Inspired by <a href="https://github.com/hletrd/data-waster/tree/master">Data Waster</a><span className="footer-dot">·</span><a href="https://github.com/codyinnyc/bandwidth-site">View source <Icon name="arrow"/></a></span></footer>
  </>;
}
