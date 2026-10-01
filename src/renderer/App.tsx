import { useEffect, useRef, useState } from 'react';
import { NOTCH } from '@shared/config';
import { api } from './lib/api';
import { useMascot } from './mascot/machine';
import { Notch } from './notch/Notch';
import { Pill } from './notch/Pill';
import { TopBar } from './notch/TopBar';
import { Home } from './screens/Home';
import { useData } from './store/data';
import { useUi } from './store/ui';

function useLook(hovered: boolean): { x: number; y: number } | null {
  const [look, setLook] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      // Centro aproximado do mascote no Início.
      const cx = window.innerWidth / 2;
      const cy = NOTCH.topBarHeight + 80;
      const dx = (e.clientX - cx) / 220;
      const dy = (e.clientY - cy) / 160;
      setLook({ x: Math.max(-1, Math.min(1, dx)), y: Math.max(-1, Math.min(1, dy)) });
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);
  return hovered ? look : null;
}

export function App(): React.JSX.Element {
  const ui = useUi();
  const loaded = useData((s) => s.loaded);
  const [hovered, setHovered] = useState(false);
  const [bump, setBump] = useState(0);
  const look = useLook(hovered);
  const mascot = useMascot(hovered);
  const clicks = useRef<number[]>([]);

  useEffect(() => {
    void useData.getState().load();
    const offs = [
      api.on('ui:toggle', () => useUi.setState((s) => ({ expanded: !s.expanded }))),
      api.on('ui:collapse', () => useUi.getState().setExpanded(false)),
      api.on('ui:navigate', (p) => useUi.getState().setTab(p.tab, p.expand)),
      api.on('ui:paused', (paused) => {
        const s = useData.getState().settings;
        if (s) useData.getState().set({ settings: { ...s, paused } });
      }),
    ];
    api.send('ui:ready', null);
    return () => offs.forEach((off) => off());
  }, []);

  const onMascotClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    setBump((b) => b + 1);
    const now = Date.now();
    clicks.current = [...clicks.current.filter((t) => now - t < 2000), now];
  };

  const screen = (() => {
    switch (ui.tab) {
      default:
        return (
          <Home
            state={mascot.state}
            badge={mascot.badge}
            mood={mascot.mood}
            accessories={mascot.accessories}
            look={look}
            bump={bump}
            onMascotClick={onMascotClick}
            onStartFocus={() => undefined}
            entrance={null}
          />
        );
    }
  })();

  if (!loaded) return <div />;

  return (
    <Notch
      glow={mascot.glow}
      onHoverChange={setHovered}
      topBar={<TopBar />}
      pill={<Pill state={mascot.state} badge={mascot.badge} mood={mascot.mood} accessories={mascot.accessories} clipboardCandidate={null} />}
    >
      {screen}
    </Notch>
  );
}
