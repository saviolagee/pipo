import { motion } from 'motion/react';
import { IconChat, IconCheckCircle, IconGear, IconHome, IconPlus, IconSpeaker } from '../components/Icons';
import { t } from '../i18n/pt-BR';
import { api } from '../lib/api';
import { useData } from '../store/data';
import { useUi, type Tab } from '../store/ui';

const TABS: Array<{ id: Tab; label: string; Icon: (p: { size?: number }) => React.JSX.Element }> = [
  { id: 'home', label: t.tabs.home, Icon: IconHome },
  { id: 'tasks', label: t.tabs.tasks, Icon: IconCheckCircle },
  { id: 'chat', label: t.tabs.chat, Icon: IconChat },
  { id: 'add', label: t.tabs.add, Icon: IconPlus },
];

function TabButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`relative flex h-[26px] w-[34px] items-center justify-center rounded-full transition-colors ${active ? 'text-white' : 'text-[#9b9ba3] hover:text-white'}`}
    >
      {active && <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-full" style={{ background: '#2A2A2E' }} transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
      <span className="relative">{children}</span>
    </button>
  );
}

/** Barra superior de 36px: abas à esquerda, configurações e som à direita [Ref 1, 3]. */
export function TopBar(): React.JSX.Element {
  const tab = useUi((s) => s.tab);
  const setTab = useUi((s) => s.setTab);
  const settings = useData((s) => s.settings);
  const muted = settings?.muted ?? false;

  const toggleMute = async (): Promise<void> => {
    const next = await api.invoke('settings:patch', { muted: !muted });
    useData.getState().set({ settings: next });
  };

  return (
    <div className="flex h-[36px] items-center justify-between px-[10px]">
      <div className="flex items-center gap-[2px]">
        {TABS.map(({ id, label, Icon }) => (
          <TabButton key={id} active={tab === id} label={label} onClick={() => setTab(id)}>
            <Icon size={id === 'add' ? 15 : 16} />
          </TabButton>
        ))}
      </div>
      <div className="flex items-center gap-[2px]">
        <TabButton active={tab === 'settings'} label={t.tabs.settings} onClick={() => setTab('settings')}>
          <IconGear size={16} />
        </TabButton>
        <TabButton active={false} label={muted ? t.tabs.unmute : t.tabs.mute} onClick={() => void toggleMute()}>
          <IconSpeaker size={16} muted={muted} />
        </TabButton>
      </div>
    </div>
  );
}
