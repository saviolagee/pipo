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
import { FocusCard } from './screens/FocusCard';
import { RitualCheck } from './screens/RitualCheck';
import { TasksScreen } from './screens/Tasks';
import { DayReview } from './screens/DayReview';
import { ChatScreen } from './screens/Chat';
import { bindAgentEvents, useChat } from './store/chat';
import { LocalAudio } from './components/LocalAudio';
import { Toasts } from './components/Toast';
import { DropZone, ingestDropped } from './screens/DropZone';
import { QuickCapture } from './screens/QuickCapture';
import type { IngestProgress } from '@shared/types';
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
  // No chat, cards de ação aparecem inline na conversa (seção 8.7).
  const overlayCards = ui.tab === 'chat' ? ui.cards.filter((c) => c.kind !== 'action') : ui.cards;
  const topCard = overlayCards[overlayCards.length - 1] ?? null;
  const [ingest, setIngest] = useState<IngestProgress | null>(null);
  const [swallowing, setSwallowing] = useState<string | null>(null);
  const [clip, setClip] = useState<string | null>(null);

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
      bindAgentEvents(),
      api.on('ui:toggle', () => useUi.setState((s) => ({ expanded: !s.expanded }))),
      api.on('ui:collapse', () => useUi.getState().setExpanded(false)),
      api.on('ui:navigate', (p) => {
        useUi.getState().setTab(p.tab, p.expand);
        if (p.weekly !== undefined) useUi.setState({ weeklyReview: p.weekly });
        if (p.capture !== undefined) useUi.setState({ captureMode: p.capture, voiceRequested: !!p.voice, capturePurpose: p.purpose ?? null });
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
      api.on('chat:send', ({ text }) => {
        useUi.getState().setTab('chat');
        useChat.getState().newConversation();
        void useChat.getState().send(text);
      }),
      api.on('focus:state', (focus) => {
        const prev = useData.getState().focus;
        useData.getState().set({ focus });
        // Foco começou: abre o notch no Início (ritual ou card da sessão).
        if (focus && !prev) useUi.getState().setTab('home');
      }),
      api.on('tasks:changed', () => void useData.getState().refreshTasks()),
      api.on('stats:changed', (stats) => useData.getState().set({ stats })),
      api.on('activity:current', (activity) => useData.getState().set({ activity })),
      api.on('toast:show', (toast) => useUi.getState().pushToast(toast)),
      api.on('meeting:active', (inMeeting) => useData.getState().set({ inMeeting })),
      api.on('integrations:changed', (integrations) => useData.getState().set({ integrations })),
      api.on('music:nowPlaying', (nowPlaying) => useData.getState().set({ nowPlaying })),
      api.on('mood:changed', (mood) => useData.getState().set({ mood })),
      api.on('streak:changed', (streak) => useData.getState().set({ streak })),
      api.on('files:progress', (p) => setIngest(p.done && !p.error ? null : p)),
      api.on('clipboard:candidate', ({ text }) => {
        // Carinha curiosa + botão "virar tarefa?" na pill por 5s (sem expandir).
        setClip(text);
        setTimeout(() => setClip((c) => (c === text ? null : c)), 5000);
      }),
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
  const ritualPhase = useData((s) => s.focus?.phase === 'ritual');
  useEffect(() => {
    useUi.getState().pin('ritual', ritualPhase);
  }, [ritualPhase]);
  useEffect(() => {
    useUi.getState().pin('onboarding', onboarding);
    if (onboarding) useUi.getState().setExpanded(true);
  }, [onboarding]);

  // Arrastar arquivo sobre o notch (mesmo colapsado) abre a aba ＋ com a zona de drop [Ref 7, 8].
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      depth++;
      e.preventDefault();
      useUi.setState({ dragOver: true, expanded: true, tab: 'add', captureMode: false });
      void api.invoke('window:setInteractive', true);
    };
    const over = (e: DragEvent): void => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) useUi.setState({ dragOver: false });
    };
    const drop = async (e: DragEvent): Promise<void> => {
      e.preventDefault();
      depth = 0;
      useUi.setState({ dragOver: false });
      const files = e.dataTransfer?.files;
      if (!files?.length) return;
      setSwallowing(files[0].name);
      play('gulp');
      setTimeout(() => setSwallowing(null), 500);
      useUi.getState().pin('ingest', true);
      const { attachments, error } = await ingestDropped(files);
      useUi.getState().pin('ingest', false);
      if (error) useUi.getState().pushToast({ id: `err:${Date.now()}`, text: error });
      if (attachments.length) {
        // Vai para o chat com o arquivo como chip e o input focado.
        useChat.getState().addAttachments(attachments);
        useUi.getState().setTab('chat');
      }
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    const onDrop = (e: DragEvent): void => void drop(e);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
    };
  }, []);

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
  const focus = useData((s) => s.focus);

  /** "Começar foco": próxima tarefa sugerida; sem tarefa, abre a captura. */
  const startFocus = useCallback(async () => {
    const next = await api.invoke('tasks:nextSuggested');
    if (!next) {
      useUi.getState().setTab('add');
      useUi.setState({ captureMode: true });
      return;
    }
    await api.invoke('focus:start', { taskId: next.id });
  }, []);

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
            if (planNow) void useChat.getState().send('Planejar meu dia');
            void useData.getState().refreshStats();
          }}
        />
      );
    if (topCard) return <AttentionCard key={topCard.id} card={topCard} mood={mascot.mood} accessories={mascot.accessories} />;
    switch (ui.tab) {
      case 'settings':
        return <SettingsScreen />;
      case 'tasks':
        return <TasksScreen />;
      case 'review':
        return <DayReview />;
      case 'chat':
        return <ChatScreen mood={mascot.mood} accessories={mascot.accessories} state={mascot.state} />;
      case 'add':
        if (ui.dragOver || ingest || swallowing) return <DropZone progress={ingest} swallowing={swallowing} />;
        return <QuickCapture key={ui.captureMode ? 'cap' : 'add'} autoVoice={ui.voiceRequested} />;
      default:
        if (focus?.phase === 'ritual') return <RitualCheck />;
        if (focus) return <FocusCard focus={focus} state={mascot.state} badge={mascot.badge} mood={mascot.mood} accessories={mascot.accessories} onMascotClick={onMascotClick} bump={bump} />;
        return (
          <Home
            state={mascot.state}
            badge={mascot.badge}
            mood={mascot.mood}
            accessories={mascot.accessories}
            look={look}
            bump={bump}
            onMascotClick={onMascotClick}
            onStartFocus={() => void startFocus()}
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
        topBar={onboarding || (ui.tab === 'add' && ui.captureMode && !ui.dragOver) ? null : <TopBar />}
        fixedHeight={!onboarding && !topCard && ui.tab === 'chat' ? 384 : null}
        pill={<Pill state={mascot.state} badge={mascot.badge} mood={mascot.mood} accessories={mascot.accessories} clipboardCandidate={
              clip ? (
                <button
                  type="button"
                  className="rounded-full bg-white px-[10px] py-[2px] text-[11px] font-medium text-black"
                  onClick={(e) => {
                    e.stopPropagation();
                    const text = clip;
                    setClip(null);
                    void api.invoke('capture:clipboardToTask', text);
                  }}
                >
                  {t.capture.clipboardAsk}
                </button>
              ) : null
            }
          />
        }
      >
        <div className="relative">
          {screen}
          <Confetti burst={ui.confettiKey} count={ui.confettiCount} />
        </div>
      </Notch>
      <AnimatePresence>{ui.debugOpen && <DebugPanel />}</AnimatePresence>
      <LocalAudio />
      <Toasts top={ui.expanded ? 260 : 32} />
    </>
  );
}
