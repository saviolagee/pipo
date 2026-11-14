// Pipo em tela cheia: janela normal com as mesmas telas do notch, em tamanho grande, e uma barra
// lateral no lugar das abas. O notch continua no topo; as duas janelas mostram os mesmos dados.
import { motion } from 'motion/react';
import { useEffect } from 'react';
import { IconChart, IconChat, IconCheckCircle, IconGear, IconHome, IconPlus, IconTeam, IconTrail } from './components/Icons';
import { Toasts } from './components/Toast';
import { t } from './i18n/pt-BR';
import { api } from './lib/api';
import { bindDataEvents } from './lib/sync';
import { Mascot } from './mascot/Mascot';
import { useMascot } from './mascot/machine';
import { ChatScreen } from './screens/Chat';
import { DayReview } from './screens/DayReview';
import { ingestDropped } from './screens/DropZone';
import { Home } from './screens/Home';
import { QuickCapture } from './screens/QuickCapture';
import { SettingsScreen } from './screens/Settings';
import { TasksScreen } from './screens/Tasks';
import { TeamScreen } from './screens/Team';
import { TrailScreen } from './screens/Trail';
import { bindAgentEvents, useChat } from './store/chat';
import { useData } from './store/data';
import { bindGoalEvents } from './store/goals';
import { bindPipoEvents } from './store/pipos';
import { useUi, type Tab } from './store/ui';

const f = t.full;
const TABS: Tab[] = ['home', 'trail', 'tasks', 'chat', 'team', 'review', 'add', 'settings'];
const ICON: Record<Tab, (p: { size?: number }) => React.JSX.Element> = {
  home: IconHome,
  trail: IconTrail,
  tasks: IconCheckCircle,
  chat: IconChat,
  team: IconTeam,
  review: IconChart,
  add: IconPlus,
  settings: IconGear,
};

function NavItem({ tab, active }: { tab: Tab; active: boolean }): React.JSX.Element {
  const Icon = ICON[tab];
  return (
    <button
      type="button"
      onClick={() => useUi.getState().setTab(tab)}
      className={`relative flex h-[36px] w-full items-center gap-[12px] rounded-[10px] px-[12px] text-left text-[13.5px] transition-colors ${active ? 'text-white' : 'text-fg-2 hover:bg-white/[0.04] hover:text-fg'}`}
    >
      {active && <motion.span layoutId="full-nav" className="absolute inset-0 rounded-[10px]" style={{ background: '#1f1f23', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)' }} transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
      <span className="relative flex w-[18px] justify-center">
        <Icon size={16} />
      </span>
      <span className="relative">{f.tabs[tab]}</span>
    </button>
  );
}

export function FullApp(): React.JSX.Element {
  const tab = useUi((s) => s.tab);
  const loaded = useData((s) => s.loaded);
  const onboarding = useData((s) => s.loaded && s.firstRun);
  const phrase = useData((s) => s.mood.phrase);
  const mascot = useMascot(false);

  useEffect(() => {
    const first = new URLSearchParams(location.search).get('tab');
    void useData
      .getState()
      .load()
      .then(() => {
        if (first && TABS.includes(first as Tab)) useUi.getState().setTab(first as Tab);
      });
    const offs = [
      bindAgentEvents(),
      bindPipoEvents(),
      bindGoalEvents(),
      bindDataEvents(),
      api.on('app:navigate', ({ tab: next }) => TABS.includes(next as Tab) && useUi.getState().setTab(next as Tab)),
      // Os cards inline (confirmações e o plano de um Pipo) aparecem no chat daqui também.
      api.on('card:show', (card) => useUi.getState().pushCard(card)),
    ];
    // Arrastar arquivos para a janela: vira anexo no chat.
    const over = (e: DragEvent): void => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
    };
    const drop = async (e: DragEvent): Promise<void> => {
      e.preventDefault();
      const files = e.dataTransfer?.files;
      if (!files?.length) return;
      const { attachments, error } = await ingestDropped(files);
      if (error) useUi.getState().pushToast({ id: `err:${Date.now()}`, text: error });
      if (attachments.length) {
        useChat.getState().addAttachments(attachments);
        useUi.getState().setTab('chat');
      }
    };
    const onDrop = (e: DragEvent): void => void drop(e);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', onDrop);
    return () => {
      offs.forEach((off) => off());
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  if (!loaded) return <div />;
  if (onboarding)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-[14px] text-center">
        <Mascot state="happy" size={72} />
        <p className="max-w-[360px] text-[14px] text-fg-2">{f.finishOnboarding}</p>
      </div>
    );

  const screen = (() => {
    switch (tab) {
      case 'trail':
        return <TrailScreen />;
      case 'tasks':
        return <TasksScreen />;
      case 'chat':
        return <ChatScreen mood={mascot.mood} accessories={mascot.accessories} state={mascot.state} />;
      case 'team':
        return <TeamScreen />;
      case 'review':
        return <DayReview />;
      case 'add':
        return <QuickCapture />;
      case 'settings':
        return <SettingsScreen />;
      default:
        return <Home state={mascot.state} badge={mascot.badge} mood={mascot.mood} accessories={mascot.accessories} look={null} bump={0} onMascotClick={() => useUi.getState().react('happy', 900)} entrance={null} />;
    }
  })();

  return (
    <div className="flex h-full w-full">
      <aside className="flex w-[232px] shrink-0 flex-col gap-[2px] px-[12px] pb-[14px] pt-[18px]" style={{ background: '#0e0e10', borderRight: '1px solid var(--border-subtle)' }}>
        <div className="mb-[16px] flex items-center gap-[10px] px-[8px]">
          <Mascot state={mascot.state} mood={mascot.mood} size={36} accessories={mascot.accessories.filter((a) => a !== 'coffee')} glow={false} />
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-fg">Pipo</div>
            <div className="truncate text-[11.5px] text-fg-3" title={phrase}>
              {phrase}
            </div>
          </div>
        </div>
        {TABS.filter((x) => x !== 'settings').map((x) => (
          <NavItem key={x} tab={x} active={tab === x} />
        ))}
        <span className="flex-1" />
        <button type="button" onClick={() => void api.invoke('dash:open', null)} className="flex h-[36px] w-full items-center gap-[12px] rounded-[10px] px-[12px] text-left text-[13.5px] text-fg-2 transition-colors hover:bg-white/[0.04] hover:text-fg">
          <span className="flex w-[18px] justify-center">
            <IconChart size={16} />
          </span>
          {f.dashboards}
        </button>
        <NavItem tab="settings" active={tab === 'settings'} />
        <p className="mt-[10px] px-[12px] text-[10.5px] text-fg-3">{f.fullscreenHint}</p>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[64px] shrink-0 items-center px-[32px]">
          <h1 className="text-[19px] font-semibold text-fg">{f.tabs[tab]}</h1>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <motion.div key={tab} className="mx-auto w-full max-w-[960px] px-[20px]" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
            {screen}
          </motion.div>
        </div>
      </main>
      <Toasts top={16} />
    </div>
  );
}
