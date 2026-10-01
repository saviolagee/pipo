import { create } from 'zustand';
import type {
  CalendarEvent,
  ClaudeStatus,
  Client,
  CurrentActivity,
  DayStats,
  FocusState,
  IntegrationInfo,
  MoodInfo,
  NowPlaying,
  Profile,
  Ritual,
  Settings,
  StreakInfo,
  Task,
} from '@shared/types';
import { api } from '../lib/api';

interface DataState {
  loaded: boolean;
  firstRun: boolean;
  platform: string;
  profile: Profile | null;
  settings: Settings | null;
  rituals: Ritual[];
  clients: Client[];
  tasks: Task[];
  focus: FocusState | null;
  stats: DayStats | null;
  mood: MoodInfo;
  streak: StreakInfo;
  integrations: IntegrationInfo[];
  claude: ClaudeStatus;
  nowPlaying: NowPlaying | null;
  activity: CurrentActivity | null;
  inMeeting: boolean;
  events: CalendarEvent[];
  load: () => Promise<void>;
  refreshTasks: () => Promise<void>;
  refreshStats: () => Promise<void>;
  set: (p: Partial<DataState>) => void;
}

export const useData = create<DataState>((set, get) => ({
  loaded: false,
  firstRun: false,
  platform: 'linux',
  profile: null,
  settings: null,
  rituals: [],
  clients: [],
  tasks: [],
  focus: null,
  stats: null,
  mood: { mood: 60, phrase: '', components: { adherence: 0.5, focusCompletion: 0.5, distraction: 0, overworkPenalty: 0, today: 60, weekAvg: 60 } },
  streak: { currentDays: 0, bestDays: 0, unlocked: [], equipped: [] },
  integrations: [],
  claude: { state: 'checking' },
  nowPlaying: null,
  activity: null,
  inMeeting: false,
  events: [],
  load: async () => {
    const b = await api.invoke('app:bootstrap');
    set({
      loaded: true,
      firstRun: b.firstRun,
      platform: b.platform,
      profile: b.profile,
      settings: b.settings,
      rituals: b.rituals,
      clients: b.clients,
      streak: b.streak,
      mood: b.mood,
      focus: b.focus,
      integrations: b.integrations,
      claude: b.claude,
    });
    await Promise.all([get().refreshTasks(), get().refreshStats()]);
  },
  refreshTasks: async () => {
    set({ tasks: await api.invoke('tasks:all') });
  },
  refreshStats: async () => {
    set({ stats: await api.invoke('stats:today') });
  },
  set: (p) => set(p),
}));
