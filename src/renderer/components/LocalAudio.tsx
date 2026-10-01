import { useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { useData } from '../store/data';

/** Toca o arquivo de música local do ritual em loop (seção 9.4). */
export function LocalAudio(): React.JSX.Element {
  const ref = useRef<HTMLAudioElement>(null);
  const settings = useData((s) => s.settings);

  useEffect(
    () =>
      api.on('music:local', ({ action, filePath }) => {
        const el = ref.current;
        if (!el) return;
        if (action === 'play' && filePath) {
          const src = `pipo-media://file/${encodeURIComponent(filePath)}`;
          if (el.src !== src) el.src = src;
          void el.play().catch((e) => console.warn('[música] não tocou:', e));
        } else if (action === 'pause') el.pause();
        else if (action === 'stop') {
          el.pause();
          el.removeAttribute('src');
          el.load();
        }
      }),
    [],
  );

  useEffect(() => {
    if (ref.current && settings) ref.current.volume = settings.muted ? 0 : Math.min(1, settings.volume * 0.8);
  }, [settings]);

  return <audio ref={ref} loop preload="none" hidden />;
}
