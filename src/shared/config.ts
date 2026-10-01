export const APP_NAME = 'Pipo';
export const APP_ID = 'app.pipo.desktop';

/** Janela nativa transparente que contém o notch (seção 4). */
export const WINDOW = {
  width: 760,
  height: 600,
} as const;

/** Medidas do notch (seção 5). */
export const NOTCH = {
  pillWidth: 340,
  pillHeight: 32,
  expandedWidth: 680,
  topBarHeight: 36,
  chatHeight: 420,
  hoverExpandMs: 300,
  leaveCollapseMs: 1500,
} as const;

export const DEFAULT_SHORTCUTS = {
  toggle: 'CommandOrControl+Shift+Space',
  quickCapture: 'CommandOrControl+Shift+K',
  focusNext: 'CommandOrControl+Shift+F',
} as const;

export type ShortcutId = keyof typeof DEFAULT_SHORTCUTS;

export const TIMEZONE = 'America/Sao_Paulo';

/** Registro de atividade (seção 9.5). */
export const ACTIVITY = {
  pollMs: 5_000,
  idleThresholdSec: 180,
} as const;

/** Orçamento por nível de presença (seção 7, tela 13). */
export const PRESENCE_BUDGET = { quiet: 3, balanced: 5, present: 8 } as const;

/** Intervalo mínimo entre interrupções que gastam orçamento (seção 12). */
export const MIN_INTERRUPTION_GAP_MIN = 20;

export const STREAK_UNLOCKS = [
  { days: 3, accessory: 'scarf' },
  { days: 7, accessory: 'cool_glasses' },
  { days: 14, accessory: 'hat' },
  { days: 30, accessory: 'crown' },
  { days: 60, accessory: 'cape' },
] as const;

export const DEFAULT_DISTRACTIONS = [
  'YouTube',
  'Instagram',
  'WhatsApp Web',
  'X',
  'TikTok',
  'Netflix',
  'Notícias',
] as const;

/** Apps que nunca são registrados por padrão (seção 9.5, privacidade). */
export const DEFAULT_IGNORED_APPS = ['1Password', 'Bitwarden', 'KeePassXC', 'LastPass', 'Dashlane', 'Keychain Access'];
