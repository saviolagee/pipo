// Tipos de domínio compartilhados entre main, preload e renderer.

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = domingo

export type FocusPresetId = 'p25' | 'p50' | 'deep90' | 'custom';
export interface FocusPreset {
  id: FocusPresetId;
  focusMin: number;
  breakMin: number;
  longBreakMin: number;
  cycles: number;
}

export type EnergyPeak = 'morning' | 'afternoon' | 'evening' | 'varies';
export type PresenceLevel = 'quiet' | 'balanced' | 'present';
export type Tone = 'cute' | 'direct';

export interface Profile {
  name: string;
  workDays: Weekday[];
  startTime: string; // HH:MM
  endTime: string;
  lunchStart: string;
  lunchMin: number;
  dailyGoalMin: number;
  /** Meta diferente por dia (minutos), ou null para usar dailyGoalMin. */
  goalPerDay: Partial<Record<Weekday, number>> | null;
  energyPeak: EnergyPeak;
  focusPreset: FocusPreset;
  presenceLevel: PresenceLevel;
  interruptBudget: number;
  tone: Tone;
  autostart: boolean;
  onboardedAt: string | null;
}

export type RitualKind = 'music' | 'coffee' | 'phone' | 'desk' | 'top3' | 'two_min' | 'tabs' | 'breathe' | 'custom';

export type MusicSource = 'spotify' | 'link' | 'file';
export interface MusicConfig {
  source: MusicSource | null;
  link: string | null;
  filePath: string | null;
  autoplay: boolean;
  pauseOnBreak: boolean;
}
export interface CustomRitualConfig {
  remind: boolean;
}
export type RitualConfig = MusicConfig | CustomRitualConfig | Record<string, never>;

export interface Ritual {
  id: number;
  kind: RitualKind;
  label: string;
  enabled: boolean;
  config: RitualConfig;
  position: number;
}

export interface Client {
  id: number;
  name: string;
  keywords: string[];
  color: string;
  archived: boolean;
}

export interface DistractionSettings {
  items: string[];
  toleranceSec: 30 | 60 | 180;
  /** Apps/sites liberados com "Sempre permitir". */
  allowed: string[];
}

export interface PrivacySettings {
  trackingPaused: boolean;
  ignoredApps: string[];
}

export interface ReactionSettings {
  meeting: boolean;
  email: boolean;
  clipboard: boolean;
  unstuck: boolean;
  /** Dançar quando estiver tocando música. */
  music: boolean;
}

export type TaskStatus = 'todo' | 'doing' | 'done' | 'snoozed';
export type TaskSource = 'manual' | 'voice' | 'agent' | 'file' | 'clipboard';
export type Priority = 1 | 2 | 3;

export interface Subtask {
  id: number;
  taskId: number;
  title: string;
  done: boolean;
  position: number;
}

export interface Task {
  id: number;
  title: string;
  notes: string;
  dueAt: string | null; // ISO
  estimateMin: number | null;
  priority: Priority;
  clientId: number | null;
  status: TaskStatus;
  snoozeCount: number;
  source: TaskSource;
  isToday: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  subtasks: Subtask[];
}

export interface TaskInput {
  title: string;
  notes?: string;
  dueAt?: string | null;
  estimateMin?: number | null;
  priority?: Priority;
  clientId?: number | null;
  source?: TaskSource;
  isToday?: boolean;
  subtasks?: string[];
}

export type TaskPatch = Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'subtasks'>>;

export type TaskFilter = 'today' | 'upcoming' | 'someday' | 'overdue' | 'done_today' | 'open';

export type FocusPhase = 'ritual' | 'focus' | 'break' | 'longBreak';

export interface FocusState {
  sessionId: number;
  taskId: number | null;
  taskTitle: string;
  phase: FocusPhase;
  cycle: number;
  totalCycles: number;
  phaseStartedAt: number;
  phaseDurationSec: number;
  remainingSec: number;
  paused: boolean;
  microStep: string | null;
  musicActive: boolean;
  focusedSec: number;
  distractedSec: number;
}

export type ActivityCategory = 'work' | 'distraction' | 'client' | 'idle' | 'meeting';

export interface ActivityBlock {
  id: number;
  startedAt: string;
  endedAt: string;
  app: string;
  title: string;
  url: string | null;
  category: ActivityCategory;
  clientId: number | null;
  idle: boolean;
}

export interface CurrentActivity {
  app: string;
  title: string;
  url: string | null;
  category: ActivityCategory;
  clientId: number | null;
  since: number;
}

export interface DayStats {
  date: string; // YYYY-MM-DD
  workedMin: number;
  goalMin: number;
  focusMin: number;
  distractedMin: number;
  meetingMin: number;
  plannedMin: number;
  openTodayTasks: number;
  focusSessionsCompleted: number;
  nextMeeting: CalendarEvent | null;
}

export interface TimeReportRow {
  key: string;
  label: string;
  minutes: number;
  color?: string;
}

export type MascotState =
  | 'idle'
  | 'looking'
  | 'happy'
  | 'working'
  | 'thinking'
  | 'attention'
  | 'sleepy'
  | 'eating'
  | 'celebrating'
  | 'dizzy'
  | 'sad'
  | 'tired'
  | 'listening'
  | 'shh'
  | 'dancing';

export type Accessory =
  | 'headphones'
  | 'glasses'
  | 'coffee'
  | 'nightcap'
  | 'scarf'
  | 'cool_glasses'
  | 'hat'
  | 'crown'
  | 'cape';

export type UnlockableAccessory = 'scarf' | 'cool_glasses' | 'hat' | 'crown' | 'cape';

export interface StreakInfo {
  currentDays: number;
  bestDays: number;
  unlocked: UnlockableAccessory[];
  equipped: UnlockableAccessory[];
}

export interface MoodInfo {
  mood: number; // 0–100
  components: MoodComponents;
  phrase: string;
}

export interface MoodComponents {
  adherence: number;
  focusCompletion: number;
  distraction: number;
  overworkPenalty: number;
  today: number;
  weekAvg: number;
}

export type GlowKind = 'none' | 'focus' | 'attention' | 'done' | 'dizzy';

export type CardKind =
  | 'meeting'
  | 'pomodoro_end'
  | 'break_end'
  | 'distraction'
  | 'deadline'
  | 'goal_reached'
  | 'goal_exceeded'
  | 'context_email'
  | 'meeting_followup'
  | 'pattern'
  | 'action'
  | 'unstuck'
  | 'done'
  | 'unlock'
  | 'agent_error'
  | 'plan_day'
  | 'close_day'
  | 'info';

export interface CardButton {
  id: string;
  label: string;
  kbd?: 'Y' | 'N';
  variant: 'primary' | 'secondary' | 'tertiary';
}

export interface Card {
  id: string;
  kind: CardKind;
  glow: GlowKind;
  mascot: MascotState;
  /** Texto cinza ao lado de "● Pipo" (ex.: "reunião chegando"). */
  label: string;
  /** Caixa mono com o assunto. */
  subject?: string;
  /** Título grande (cards de concluído). */
  title?: string;
  body?: string;
  buttons: CardButton[];
  autoDismissMs?: number;
}

export interface Toast {
  id: string;
  text: string;
  undoable?: boolean;
  durationMs?: number;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  meetingUrl: string | null;
}

export type IntegrationProvider = 'google' | 'spotify' | 'claude';
export type IntegrationStatus = 'connected' | 'disconnected' | 'error';

export interface IntegrationInfo {
  provider: IntegrationProvider;
  status: IntegrationStatus;
  detail: string | null;
}

export type ClaudeStatus =
  | { state: 'ok'; version: string | null }
  | { state: 'not_logged'; version: string | null; message: string }
  | { state: 'not_installed' }
  | { state: 'checking' };

export interface NowPlaying {
  track: string;
  artist: string;
  playing: boolean;
  /** De onde veio a leitura: API do Spotify, título da janela do app do Spotify ou o arquivo do ritual. */
  source?: 'spotify-api' | 'spotify-window' | 'local';
}

export interface Attachment {
  id: number;
  conversationId: number | null;
  filename: string;
  mime: string;
  path: string;
  createdAt: string;
}

export interface ChatMessage {
  id: number;
  conversationId: number;
  role: 'user' | 'assistant';
  text: string;
  attachments: Attachment[];
  createdAt: string;
}

export interface Conversation {
  id: number;
  title: string;
  createdAt: string;
  claudeSessionId: string | null;
}

export type AgentEvent =
  | { type: 'start'; conversationId: number }
  | { type: 'delta'; conversationId: number; text: string }
  | { type: 'tool'; conversationId: number; name: string }
  | { type: 'done'; conversationId: number; text: string }
  | { type: 'error'; conversationId: number; code: AgentErrorCode; message: string };

export type AgentErrorCode = 'not_installed' | 'not_logged' | 'rate_limited' | 'failed' | 'unavailable';

export interface IngestProgress {
  attachmentId: number | null;
  filename: string;
  percent: number;
  done: boolean;
  error?: string;
}

export interface Settings {
  volume: number;
  muted: boolean;
  paused: boolean;
  shortcuts: Record<'toggle' | 'quickCapture' | 'focusNext', string>;
  distractions: DistractionSettings;
  privacy: PrivacySettings;
  reactions: ReactionSettings;
}

export interface Bootstrap {
  profile: Profile | null;
  settings: Settings;
  rituals: Ritual[];
  clients: Client[];
  streak: StreakInfo;
  mood: MoodInfo;
  focus: FocusState | null;
  integrations: IntegrationInfo[];
  claude: ClaudeStatus;
  firstRun: boolean;
  platform: 'win32' | 'darwin' | 'linux' | string;
}

export interface PatternSuggestion {
  kind: 'snoozed_client' | 'snoozed_word' | 'best_hour' | 'distracted_day';
  text: string;
  /** Sugestão de bloco recorrente (dia da semana e hora). */
  block: { weekday: Weekday; hour: number; durationMin: number; title: string } | null;
}

export interface WeeklySummary {
  workedMin: number;
  goalMin: number;
  focusSessions: number;
  distractedMin: number;
  byClient: TimeReportRow[];
  pattern: PatternSuggestion | null;
}

export interface DayReview {
  stats: DayStats;
  byClient: TimeReportRow[];
  byApp: TimeReportRow[];
  pending: Task[];
  unclassified: ActivityBlock[];
  goalReached: boolean;
}

export interface ParsedCapture {
  title: string;
  dueAt: string | null;
  estimateMin: number | null;
  clientId: number | null;
  priority: Priority;
}
