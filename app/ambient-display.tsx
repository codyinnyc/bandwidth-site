'use client';

import { useEffect, useRef, useState } from 'react';

type AmbientProps = {
  downloadRate: string; uploadRate: string; combinedRate: string;
  downloaded: string; uploaded: string; transferred: string; onStop: () => void;
};

export default function AmbientDisplay({ downloadRate, uploadRate, combinedRate, downloaded, uploaded, transferred, onStop }: AmbientProps) {
  const [visible, setVisible] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLDivElement>(null);
  const interacting = useRef(false);
  const keyboardFocus = useRef(false);

  useEffect(() => {
    if (visible) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') timer = setTimeout(() => setVisible(true), 20000);
    };
    reset();
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    window.addEventListener('scroll', reset, { passive: true });
    document.addEventListener('visibilitychange', reset);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
      window.removeEventListener('scroll', reset);
      document.removeEventListener('visibilitychange', reset);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const element = dialog.current, frame = viewport.current, bounds = stage.current, content = readout.current;
    if (!element || !frame || !bounds || !content) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    element.showModal();
    // Safari otherwise focuses the first button on entry. Start on the readout;
    // keyboard users can still Tab to either action and see an inset focus ring.
    content.focus({ preventScroll: true });
    interacting.current = false;
    keyboardFocus.current = false;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const visualViewport = window.visualViewport;
    let x = 0, y = 0, maxX = 0, maxY = 0, dx = 1, dy = -1;
    let initialized = false, previousTime = 0, animationFrame = 0;
    const paint = () => { content.style.transform = `translate3d(${x}px, ${y}px, 0)`; };
    const measure = () => {
      // Dynamic viewport units handle browser chrome; VisualViewport also handles
      // zoom and the keyboard. Safe-area padding lives on the inner stage.
      frame.style.width = `${visualViewport?.width ?? window.innerWidth}px`;
      frame.style.height = `${visualViewport?.height ?? window.innerHeight}px`;
      frame.style.left = `${visualViewport?.offsetLeft ?? 0}px`;
      frame.style.top = `${visualViewport?.offsetTop ?? 0}px`;
      maxX = Math.max(0, bounds.clientWidth - content.offsetWidth);
      maxY = Math.max(0, bounds.clientHeight - content.offsetHeight);
      if (!initialized || reducedMotion.matches) {
        x = maxX / 2; y = maxY / 2; initialized = true;
      } else {
        x = Math.min(x, maxX); y = Math.min(y, maxY);
      }
      paint();
    };
    const animate = (time: number) => {
      const seconds = previousTime ? Math.min((time - previousTime) / 1000, .05) : 0;
      previousTime = time;
      if (!reducedMotion.matches && !interacting.current && !keyboardFocus.current) {
        // Constant, visible drift: about 17 CSS pixels/second diagonally.
        // Unlike a long ease-in/out loop, motion never stalls near a waypoint.
        x += dx * 10 * seconds; y += dy * 14 * seconds;
        if (x <= 0 || x >= maxX) { x = Math.max(0, Math.min(x, maxX)); dx *= -1; }
        if (y <= 0 || y >= maxY) { y = Math.max(0, Math.min(y, maxY)); dy *= -1; }
        paint();
      }
      animationFrame = requestAnimationFrame(animate);
    };
    const schedule = () => {
      cancelAnimationFrame(animationFrame); previousTime = 0;
      element.classList.toggle('ambient-paused', document.hidden);
      if (!document.hidden && !reducedMotion.matches) animationFrame = requestAnimationFrame(animate);
    };
    const motionChanged = () => { measure(); schedule(); };
    const releasePointer = () => { interacting.current = false; };
    const observer = new ResizeObserver(measure);
    measure(); observer.observe(bounds); observer.observe(content); schedule();
    visualViewport?.addEventListener('resize', measure);
    visualViewport?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    window.addEventListener('pointerup', releasePointer);
    window.addEventListener('pointercancel', releasePointer);
    reducedMotion.addEventListener('change', motionChanged);
    document.addEventListener('visibilitychange', schedule);
    return () => {
      cancelAnimationFrame(animationFrame); observer.disconnect();
      visualViewport?.removeEventListener('resize', measure);
      visualViewport?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      window.removeEventListener('pointerup', releasePointer);
      window.removeEventListener('pointercancel', releasePointer);
      reducedMotion.removeEventListener('change', motionChanged);
      document.removeEventListener('visibilitychange', schedule);
      element.close(); previousFocus?.focus({ preventScroll: true });
    };
  }, [visible]);

  return <>
    <button type="button" className="ambient-entry" onClick={() => setVisible(true)}>Enter ambient display <span aria-hidden="true">↗</span></button>
    <p className="ambient-help">Auto after 20 seconds idle. Pure black with moving, color-shifting readouts.</p>
    {visible && <dialog ref={dialog} className="ambient-screen" aria-label="Ambient transfer display" onCancel={() => setVisible(false)} onClick={() => setVisible(false)}>
      <div ref={viewport} className="ambient-viewport">
        <div ref={stage} className="ambient-stage">
          <div ref={readout} className="ambient-readout" tabIndex={-1} aria-label="Live transfer measurements"
            onClick={event => event.stopPropagation()}
            onPointerDown={() => { interacting.current = true; }}
            onFocusCapture={event => { keyboardFocus.current = event.target instanceof HTMLButtonElement; }}
            onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) keyboardFocus.current = false; }}>
            <div className="ambient-heading"><span>Bandwidth Lab</span><span className="ambient-live"><i aria-hidden="true"/>Live</span></div>
            <dl className="ambient-speeds" aria-label="Current throughput">
              {[{ label: 'Download', arrow: '↓', value: downloadRate }, { label: 'Upload', arrow: '↑', value: uploadRate }].map(({ label, arrow, value }) => <div key={label}>
                <dt><span aria-hidden="true">{arrow}</span> {label}</dt>
                <dd><span className="ambient-rate" style={{ fontSize: `min(48px, ${84 / Math.max(6, value.length)}cqi)` }}>{value}</span><span className="ambient-unit">Mbps</span></dd>
              </div>)}
            </dl>
            <dl className="ambient-combined"><div><dt>Combined</dt><dd><span>{combinedRate}</span> <small>Mbps</small></dd></div></dl>
            <dl className="ambient-usage" aria-label="Data transferred">
              <div><dt>Downloaded</dt><dd>{downloaded}</dd></div>
              <div><dt>Uploaded</dt><dd>{uploaded}</dd></div>
              <div><dt>Total used</dt><dd>{transferred}</dd></div>
            </dl>
            <div className="ambient-actions"><button type="button" onClick={() => setVisible(false)}>Show controls</button><button type="button" onClick={onStop}><span className="ambient-stop" aria-hidden="true"/>Stop transfer</button></div>
            <p className="ambient-hint">Keep this tab visible · Tap background for controls</p>
          </div>
        </div>
      </div>
    </dialog>}
  </>;
}
