'use client';

import { useEffect, useRef, useState } from 'react';

export default function AmbientDisplay({ rate, unit, transferred, onStop }: {
  rate: string; unit: string; transferred: string; onStop: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

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
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { element?.close(); previousFocus?.focus({ preventScroll: true }); };
  }, [visible]);

  return <>
    <button type="button" className="ambient-entry" onClick={() => setVisible(true)}>Enter ambient display <span aria-hidden="true">↗</span></button>
    <p className="ambient-help">Auto after 20 seconds idle. Dim colors and shifting readouts.</p>
    {visible && <dialog ref={dialog} className="ambient-screen" aria-label="Ambient transfer display" onCancel={() => setVisible(false)} onClick={() => setVisible(false)}>
      <div className="ambient-wash" aria-hidden="true"/>
      <div className="ambient-readout">
        <p className="ambient-label">Bandwidth Lab</p>
        <div className="ambient-rate">{rate}<span>{unit}</span></div>
        <p className="ambient-total">{transferred} transferred</p>
        <p className="ambient-hint">Tap to return · Keep this tab visible</p>
        <div className="ambient-actions"><button autoFocus type="button" onClick={() => setVisible(false)}>Show controls</button><button type="button" onClick={(event) => { event.stopPropagation(); onStop(); }}>Stop transfer</button></div>
      </div>
    </dialog>}
  </>;
}
