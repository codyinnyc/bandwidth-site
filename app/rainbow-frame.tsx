'use client';

import { useEffect, useRef } from 'react';

type FrameVariant = 'page' | 'screen' | 'readout';

/** Real edge elements keep the RGB fallback independent of HDR painting. */
export default function RainbowFrame({ variant }: { variant: FrameVariant }) {
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (variant !== 'page') return;
    const element = frame.current;
    if (!element) return;
    const viewport = window.visualViewport;
    const resize = () => {
      element.style.left = `${(viewport?.offsetLeft ?? 0) + 4}px`;
      element.style.top = `${(viewport?.offsetTop ?? 0) + 4}px`;
      element.style.width = `${Math.max(0, (viewport?.width ?? innerWidth) - 8)}px`;
      element.style.height = `${Math.max(0, (viewport?.height ?? innerHeight) - 8)}px`;
    };
    resize();
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    window.addEventListener('resize', resize);
    return () => {
      viewport?.removeEventListener('resize', resize);
      viewport?.removeEventListener('scroll', resize);
      window.removeEventListener('resize', resize);
    };
  }, [variant]);

  return <div ref={frame} className={`rainbow-frame rainbow-frame-${variant}`} aria-hidden="true">
    {['top', 'right', 'bottom', 'left'].map(side => <span key={side} className={`rainbow-edge rainbow-edge-${side}`}/>)}
  </div>;
}
