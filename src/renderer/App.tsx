import { AnimatePresence } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NOTCH } from '@shared/config';
import { t } from './i18n/pt-BR';
import { api } from './lib/api';
import { Confetti } from './mascot/effects/Confetti';
import { Entrance } from './mascot/Entrance';
import { useMascot } from './mascot/machine';
import { Notch } from './notch/Notch';
import { Pill } from './notch/Pill';
import { TopBar } from './notch/TopBar';
import { AttentionCard, localHandlers } from './screens/AttentionCard';
import { DebugPanel } from './screens/DebugPanel';
import { Home } from './screens/Home';
import { Onboarding } from './onboarding/Onboarding';
import { SettingsScreen } from './screens/Settings';
import { configureSfx, play } from './sound/sfx';
import { useData } from './store/data';
import { useUi } from './store/ui';

function useLook(hovered: boolean): { x: number; y: number } | null {
  const [look, setLook] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const cx = window.innerWidth / 2;
      const cy = NOTCH.topBarHeight + 80;
      setLook({ x: Math.max(-1, Math.min(1, (e.clientX - cx) / 220)), y: Math.max(-1, Math.min(1, (e.clientY - cy) / 160)) });
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);
  return hovered ? look : null;
}

/** Easter egg [Ref 11]: 5+ cliques em menos de 2s deixam o Pipo tonto por 3s. */
function triggerDizzy(): void {
  const ui = useUi.getState();
  const id = `local:dizzy:${Date.now()}`;
  ui.react('dizzy', 3000);
  ui.pushCard({
    id,
    kind: 'info',
    glow: 'dizzy',
    mascot: 'dizzy',
    label: '',
    title: t.mascot.dizzyTitle,
    body: t.mascot.dizzyBody,
    buttons: [],
    autoDismissMs: 3000,
  });
  ui.setExpanded(true);
  localHandlers.set(id, () => undefined);
  play('boing');
}

export function App(): React.JSX.Element {
  const ui = useUi();
  const loaded = useData((s) => s.loaded);
  const onboarding = useData((s) => s.loaded && s.firstRun);
  const settings = useData((s) => s.settings);
  const [hovered, setHovered] = useState(false);
  const [bump, setBump] = useState(0);
  const [entering, setEntering] = useState(true);
  const look = useLook(hovered);
  const mascot = useMascot(hovered);
  const clicks = useRef<number[]>([]);
  const topCard = ui.cards[ui.cards.length - 1] ?? null;

  useEffect(() => {
    if (settings) configureSfx(settings.volume, settings.muted);
  }, [settings]);

  useEffect(() => {
    void useData
      .getState()
      .load()
      .then(() => {
        // Entrada ao abrir o app: notch abre e o mascote chega voando; fica aberto uns segundos.
        useUi.getState().setExpanded(true);
        useUi.getState().pin('entrance', true);
        setTimeout(() => useUi.getState().pin('entrance', false), 3500);
      });
    const offs = [
      api.on('ui:toggle', () => useUi.setState((s) => ({ expanded: !s.expanded }))),
      api.on('ui:collapse', () => useUi.getState().setExpanded(false)),
      api.on('ui:navigate', (p) => {
        useUi.getState().setTab(p.tab, p.expand);
        if (p.capture !== undefined) useUi.setState({ captureMode: p.capture, voiceRequested: !!p.voice });
      }),
      api.on('ui:paused', (paused) => {
        const s = useData.getState().settings;
        if (s) useData.getState().set({ settings: { ...s, paused } });
      }),
      api.on('ui:openDebug', () => useUi.setState((s) => ({ debugOpen: !s.debugOpen }))),
      api.on('card:show', (card) => {
        const u = useUi.getState();
        const wasCollapsed = !u.expanded;
        u.pushCard(card);
        // Card dispara com o notch colapsado → expande sozinho e toca alert.
        u.setExpanded(true);
        if (card.glow === 'attention' || wasCollapsed) play(card.glow === 'done' ? 'chime' : 'alert');
      }),
      api.on('card:dismiss', ({ id }) => useUi.getState().dropCard(id)),
      api.on('mascot:react', ({ state, ms }) => useUi.getState().react(state, ms)),
      api.on('mascot:say', ({ text, ms }) => useUi.getState().say(text, ms)),
      api.on('sfx:play', (name) => play(name)),
      api.on('claude:status', (claude) => useData.getState().set({ claude })),
    ];
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'd') useUi.setState((s) => ({ debugOpen: !s.debugOpen }));
    };
    window.addEventListener('keydown', onKey);
    api.send('ui:ready', null);
    return () => {
      offs.forEach((off) => off());
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  // Cards e onboarding prendem o notch aberto.
  useEffect(() => {
    useUi.getState().pin('card', !!topCard);
  }, [topCard]);
  useEffect(() => {
    useUi.getState().pin('onboarding', onboarding);
    if (onboarding) useUi.getState().setExpanded(true);
  }, [onboarding]);

  const onMascotClick = useCallback((e: React.MouseEvent): void => {
    e.stopPropagation();
    setBump((b) => b + 1);
    play('pop');
    const now = Date.now();
    clicks.current = [...clicks.current.filter((ts) => now - ts < 2000), now];
    if (clicks.current.length >= 5) {
      clicks.current = [];
      triggerDizzy();
    }
  }, []);

  const finishEntrance = useCallback(() => setEntering(false), []);

  useEffect(() => {
    if (ui.entranceKey > 0) setEntering(true);
  }, [ui.entranceKey]);

  const screen = (() => {
    if (onboarding)
      return (
        <Onboarding
          onDone={(planNow) => {
            useData.getState().set({ firstRun: false });
            useUi.getState().setTab(planNow ? 'chat' : 'home');
            void useData.getState().refreshStats();
          }}
        />
      );
    if (topCard) return <AttentionCard key={topCard.id} card={topCard} mood={mascot.mood} accessories={mascot.accessories} />;
    switch (ui.tab) {
      case 'settings':
        return <SettingsScreen />;
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
            entrance={entering && ui.expanded ? <Entrance key={ui.entranceKey} size={76} onDone={finishEntrance} /> : null}
          />
        );
    }
  })();

  if (!loaded) return <div />;

  return (
    <>
      <Notch
        glow={mascot.glow}
        onHoverChange={setHovered}
        topBar={onboarding ? null : <TopBar />}
        pill={<Pill state={mascot.state} badge={mascot.badge} mood={mascot.mood} accessories={mascot.accessories} clipboardCandidate={null} />}
      >
        <div className="relative">
          {screen}
          <Confetti burst={ui.confettiKey} count={ui.confettiCount} />
        </div>
      </Notch>
      <AnimatePresence>{ui.debugOpen && <DebugPanel />}</AnimatePresence>
    </>
  );
}
