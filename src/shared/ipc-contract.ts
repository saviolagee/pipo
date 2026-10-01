// Contrato de IPC tipado. Main implementa `InvokeHandlers`; o renderer chama via `window.pipo.invoke`.
import type { DashData, DashRange } from './dashboard';
import type { HolidayPrefs } from './holidays';
import type { DraftInfo, Pipo, PipoLive, PipoMemoryRule, PipoModel, PipoPlaybook, PipoRun, PipoRunStep, PipoSummary, PipoTrigger, PipoVersion } from './pipos';
import type {
  ActivityBlock,
  DayKind,
  DayStatus,
  StripeIncome,
  AgentEvent,
  Attachment,
  Bootstrap,
  CalendarEvent,
  Card,
  ChatMessage,
  ClaudeStatus,
  Client,
  Conversation,
  CurrentActivity,
  DayReview,
  DayStats,
  FocusState,
  IngestProgress,
  IntegrationInfo,
  MascotState,
  MoodInfo,
  NowPlaying,
  ParsedCapture,
  Profile,
  Ritual,
  Settings,
  StreakInfo,
  Task,
  TaskFilter,
  TaskInput,
  TaskPatch,
  Toast,
  UnlockableAccessory,
  WeeklySummary,
} from './types';

export interface InvokeHandlers {
  'app:bootstrap': () => Bootstrap;
  'app:quit': () => void;
  'app:openExternal': (url: string) => void;
  'app:openTerminal': () => void;
  'app:openSystemPrefs': (pane: 'accessibility' | 'screen') => void;
  'app:pickFile': (kind: 'audio' | 'any') => string | null;
  'app:exportData': () => string | null;
  'app:wipeData': () => void;
  'app:macPermissions': () => { accessibility: boolean; screen: boolean };
  'app:askMic': () => boolean;

  'window:setInteractive': (interactive: boolean) => void;
  'window:setExpanded': (expanded: boolean) => void;

  'profile:get': () => Profile | null;
  'profile:save': (profile: Profile) => Profile;
  'profile:resetOnboarding': () => void;

  'settings:get': () => Settings;
  'settings:patch': (patch: Partial<Settings>) => Settings;

  'rituals:list': () => Ritual[];
  'rituals:save': (rituals: Omit<Ritual, 'id'>[]) => Ritual[];

  'clients:list': () => Client[];
  'clients:save': (clients: Array<Omit<Client, 'id'> & { id?: number }>) => Client[];

  'tasks:list': (filter: TaskFilter) => Task[];
  'tasks:all': () => Task[];
  'tasks:create': (input: TaskInput) => Task;
  'tasks:update': (id: number, patch: TaskPatch) => Task;
  'tasks:complete': (id: number, done: boolean) => Task;
  'tasks:delete': (id: number) => void;
  'tasks:reorder': (ids: number[]) => void;
  'tasks:snooze': (id: number) => Task;
  'tasks:nextSuggested': () => Task | null;
  'tasks:parse': (text: string) => ParsedCapture;
  'subtasks:add': (taskId: number, titles: string[]) => Task;
  'subtasks:toggle': (subtaskId: number, done: boolean) => Task;
  'subtasks:delete': (subtaskId: number) => Task;

  'focus:start': (opts: { taskId: number | null; minutes?: number; microStep?: string | null; skipRituals?: boolean }) => FocusState;
  'focus:ritualDone': (skipToday?: boolean) => FocusState | null;
  'focus:pause': () => FocusState | null;
  'focus:resume': () => FocusState | null;
  'focus:skipPhase': () => FocusState | null;
  'focus:stop': (completed: boolean) => void;
  'focus:get': () => FocusState | null;

  'stats:today': () => DayStats;
  'stats:dayReview': (date?: string) => DayReview;
  'stats:weekly': () => WeeklySummary;
  'activity:current': () => CurrentActivity | null;
  'activity:blocks': (from: string, to: string) => ActivityBlock[];
  'activity:classify': (assignments: Array<{ blockId: number; clientId: number | null }>) => void;
  'activity:exportCsv': (from: string, to: string) => string | null;
  'activity:deleteRange': (from: string, to: string) => number;

  'cards:respond': (cardId: string, buttonId: string) => void;
  'cards:respondBatch': (cardId: string, decisions: Array<{ index: number; keep: boolean; detail?: string }>) => void;
  'toasts:undo': (toastId: string) => void;

  'mood:get': () => MoodInfo;
  'streak:get': () => StreakInfo;
  'streak:equip': (equipped: UnlockableAccessory[]) => StreakInfo;

  'claude:status': (recheck: boolean) => ClaudeStatus;
  'agent:send': (opts: { conversationId: number | null; text: string; attachmentIds?: number[]; thinkMore?: boolean }) => { conversationId: number };
  'agent:cancel': (conversationId: number) => void;
  'agent:conversations': () => Conversation[];
  'agent:messages': (conversationId: number) => ChatMessage[];
  'agent:newConversation': () => Conversation;
  'agent:getProvider': () => { provider: 'claude-code' | 'anthropic-api'; hasKey: boolean };
  'agent:setProvider': (opts: { provider: 'claude-code' | 'anthropic-api'; apiKey?: string }) => void;

  'capture:submit': (opts: { text: string; source: 'manual' | 'voice' | 'clipboard' }) => Task | null;
  'capture:clipboardToTask': (text: string) => Task | null;

  'files:ingest': (paths: string[]) => Attachment[];
  'files:ingestBuffer': (file: { name: string; mime: string; data: ArrayBuffer }) => Attachment;

  'integrations:list': () => IntegrationInfo[];
  'integrations:connect': (provider: 'google' | 'spotify') => IntegrationInfo;
  'integrations:disconnect': (provider: 'google' | 'spotify' | 'stripe') => IntegrationInfo;
  'integrations:setGoogleClient': (cfg: { clientId: string; clientSecret: string }) => void;
  'integrations:setSpotifyClient': (cfg: { clientId: string }) => void;
  'calendar:upcoming': () => CalendarEvent[];
  'music:toggle': () => NowPlaying | null;
  'music:nowPlaying': () => NowPlaying | null;
  'music:test': () => void;

  'debug:simulate': (what: 'meeting' | 'pomodoro_end' | 'distraction' | 'deadline' | 'goal' | 'pattern' | 'unlock' | 'seed4weeks' | 'absence' | 'vacationBack') => void;
  'dash:open': (tab?: string | null) => void;
  'dash:data': (range: DashRange) => DashData;
  'dash:setClientEcon': (clientId: number, econ: { hourlyRate?: number | null; monthlyValue?: number | null }) => void;
  'dash:exportCsv': (name: string, csv: string) => string | null;
  'dash:exportPdf': (name: string) => string | null;
  'dash:ask': (question: string, range: DashRange) => string;
  'stripe:connect': (key: string) => string;
  'stripe:income': () => StripeIncome | null;
  'days:list': (start: string, end: string) => DayStatus[];
  'days:set': (date: string, kind: DayKind, opts?: { minutes?: number | null; note?: string | null }) => DayStatus;
  'days:clear': (date: string) => void;
  'days:setRange': (start: string, end: string, kind: DayKind, note?: string | null) => number;
  'days:clearRange': (start: string, end: string) => number;
  'days:holidayPrefs': () => HolidayPrefs;
  'days:setHolidayPrefs': (p: HolidayPrefs) => HolidayPrefs;
  'pipos:list': () => PipoSummary[];
  'pipos:get': (id: number) => { pipo: Pipo; versions: PipoVersion[]; triggers: PipoTrigger[]; runs: PipoRun[]; memory: PipoMemoryRule[]; secrets: string[] } | null;
  'pipos:create': (p: { name: string; color: Pipo['color']; accessory?: Pipo['accessory']; personality: Pipo['personality']; model?: Pipo['model']; effort?: Pipo['effort']; runOnDaysOff?: boolean }) => Pipo;
  'pipos:update': (id: number, patch: Partial<Pick<Pipo, 'name' | 'color' | 'accessory' | 'personality' | 'model' | 'effort' | 'paused' | 'runOnDaysOff'>>) => Pipo;
  'pipos:delete': (id: number) => void;
  'pipos:setSecret': (id: number, name: string, value: string | null) => string[];
  'pipos:run': (id: number, opts?: { dryRun?: boolean; trigger?: string; input?: unknown }) => { runId: number | null };
  'pipos:cancel': (runId: number) => boolean;
  'pipos:runDetail': (runId: number) => { run: PipoRun; steps: PipoRunStep[] } | null;
  'pipos:runs': (id: number) => PipoRun[];
  'pipos:saveVersion': (id: number, playbook: PipoPlaybook, changelog: string) => PipoVersion;
  'pipos:startDraft': (opts: { editSlug?: string; fromModelId?: number; fresh?: boolean }) => { conversationId: number; draftId: number; resumed: boolean; name: string | null };
  'pipos:draftFor': (conversationId: number) => DraftInfo | null;
  'pipos:submitSecret': (cardId: string, value: string) => { ok: boolean; error: string | null };
  'pipos:saveModel': (id: number) => PipoModel;
  'pipos:models': () => PipoModel[];
  'pipos:deleteModel': (id: number) => void;
  'pipos:exportFile': (id: number) => string | null;
  'pipos:importFile': (path?: string | null) => { modelId: number; name: string; secrets: string[] } | null;
  'pipos:chat': (pipoId: number) => { conversationId: number };
  'pipos:chatOwner': (conversationId: number) => { id: number; name: string; slug: string; color: string; accessory: Pipo['accessory'] } | null;
  'pipos:deleteMemory': (id: number) => void;
  'pipos:addMemory': (pipoId: number, rule: string) => void;
  'pipos:updateMemory': (id: number, rule: string) => void;
  'pipos:events': (pipoId: number) => Array<{ id: number; type: 'email_label' | 'folder' | 'meeting_end' | 'webhook'; label: string; lastFiredAt: string | null }>;
  'pipos:links': () => Array<{ from: number; to: number; kind: 'after' | 'handoff'; delayMin: number }>;
  'pipos:link': (fromId: number, toId: number, delayMin: number) => void;
  'pipos:unlink': (fromId: number, toId: number) => void;
  'pipos:wouldCycle': (fromId: number, toId: number) => boolean;
}

export type InvokeChannel = keyof InvokeHandlers;
export type InvokeArgs<K extends InvokeChannel> = Parameters<InvokeHandlers[K]>;
export type InvokeResult<K extends InvokeChannel> = ReturnType<InvokeHandlers[K]>;

/** Eventos main → renderer. */
export interface MainEvents {
  'focus:state': FocusState | null;
  'card:show': Card;
  'card:dismiss': { id: string };
  'toast:show': Toast;
  'mascot:react': { state: MascotState; ms: number };
  'mascot:say': { text: string; ms: number };
  'agent:event': AgentEvent;
  'agent:confirmAction': Card;
  'stats:changed': DayStats;
  'tasks:changed': null;
  'mood:changed': MoodInfo;
  'streak:changed': StreakInfo;
  'claude:status': ClaudeStatus;
  'integrations:changed': IntegrationInfo[];
  'music:nowPlaying': NowPlaying | null;
  'music:local': { action: 'play' | 'pause' | 'stop'; filePath?: string };
  'files:progress': IngestProgress;
  'ui:navigate': { tab: 'home' | 'tasks' | 'chat' | 'add' | 'settings' | 'review'; expand: boolean; capture?: boolean; voice?: boolean; purpose?: 'meeting'; weekly?: boolean };
  'ui:toggle': null;
  'ui:collapse': null;
  'ui:paused': boolean;
  'ui:openDebug': null;
  'clipboard:candidate': { text: string };
  'activity:current': CurrentActivity | null;
  'meeting:active': boolean;
  'sfx:play': SfxName;
  /** Abre o chat e envia uma mensagem (ex.: "Planejar meu dia" a partir de um card). */
  'chat:send': { text: string };
  'day:today': DayStatus | null;
  'dash:tab': string;
  'stripe:income': StripeIncome | null;
  'stripe:payment': { amount: number; currency: string; description: string | null };
  'pipos:changed': PipoSummary[];
  'pipos:live': PipoLive;
  'pipos:runUpdate': { run: PipoRun; steps: PipoRunStep[] };
  'pipos:handoff': { fromPipoId: number; toPipoId: number };
  'pipos:draft': DraftInfo;
  'pipos:hired': { pipoId: number; version: number };
  'ui:openPipoRun': { pipoId: number; runId: number };
}

export type MainEventName = keyof MainEvents;

export type SfxName = 'pop' | 'chime' | 'alert' | 'gulp' | 'boing' | 'tick';

/** Eventos renderer → main (fire-and-forget). */
export interface RendererEvents {
  'ui:ready': null;
  'ui:expandedChanged': boolean;
}

export interface PipoBridge {
  invoke<K extends InvokeChannel>(channel: K, ...args: InvokeArgs<K>): Promise<Awaited<InvokeResult<K>>>;
  on<K extends MainEventName>(event: K, cb: (payload: MainEvents[K]) => void): () => void;
  send<K extends keyof RendererEvents>(event: K, payload: RendererEvents[K]): void;
  /** Caminho absoluto de um File arrastado (Electron webUtils). */
  pathForFile(file: File): string;
}
