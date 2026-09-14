'use client';

import { useEffect, useState } from 'react';

type WakeStatus = 'waiting' | 'active' | 'paused' | 'blocked' | 'unsupported';

export default function WakeControl({ running, enabled, onEnabledChange }: { running: boolean; enabled: boolean; onEnabledChange: (enabled: boolean) => void }) {
  const [status, setStatus] = useState<WakeStatus>('waiting');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || !running) return;
    let disposed = false;
    let pending = false;
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      if (disposed || pending || (lock && !lock.released)) return;
      if (!('wakeLock' in navigator)) { setStatus('unsupported'); return; }
      if (document.visibilityState !== 'visible') { setStatus('paused'); return; }
      pending = true;
      try {
        const next = await navigator.wakeLock.request('screen');
        // Toggling off or stopping while the request resolves must not leak a lock.
        if (disposed) { await next.release(); return; }
        if (document.visibilityState !== 'visible') { await next.release(); setStatus('paused'); return; }
        lock = next;
        setStatus(next.released ? 'paused' : 'active');
        next.addEventListener('release', () => {
          if (!disposed && lock === next) { lock = null; setStatus('paused'); }
        }, { once: true });
      } catch {
        if (!disposed) setStatus('blocked');
      } finally { pending = false; }
    };
    const visibilityChanged = () => {
      if (document.visibilityState === 'visible') void acquire();
      else {
        setStatus('paused');
        const old = lock; lock = null;
        if (old && !old.released) void old.release().catch(() => {});
      }
    };
    void acquire();
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', visibilityChanged);
      if (lock && !lock.released) void lock.release().catch(() => {});
    };
  }, [enabled, running, attempt]);

  const message = !enabled ? 'Prevent auto-lock while a transfer is running.'
    : !running ? 'Ready for your next transfer. Keep Safari visible.'
    : status === 'active' ? 'Screen awake. Keep this tab visible.'
    : status === 'unsupported' ? 'Not supported here. Try a current version of Safari.'
    : status === 'blocked' ? 'Screen can sleep. Your browser or power settings blocked the request.'
    : status === 'paused' ? 'Screen can sleep. Return to this tab or retry.'
    : 'Requesting screen wake lock…';
  return <div className="wake-control">
    <div className="advanced-toggle"><label htmlFor="keep-awake">Keep screen awake</label><button id="keep-awake" className="switch" type="button" role="switch" aria-checked={enabled} aria-describedby="wake-help" onClick={() => { setStatus('waiting'); onEnabledChange(!enabled); }}><span/></button></div>
    <p className={`field-help${enabled && running && status === 'active' ? ' wake-active' : ''}`} id="wake-help" role="status">{message}{enabled && running && (status === 'paused' || status === 'blocked') && <> <button className="retry-wake" type="button" onClick={() => { setStatus('waiting'); setAttempt(value => value + 1); }}>Retry</button></>}</p>
  </div>;
}
