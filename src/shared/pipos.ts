// Pipos coloridos (plano V2): agentes criados pelo usuário com um plano de execução fixo e versionado.
// Nenhum Pipo vem instalado; isto é só a estrutura.
import type { AgentEffort, AgentModel } from './types';

export type PipoColor = 'orange' | 'blue' | 'green' | 'pink' | 'purple' | 'yellow' | 'cyan' | 'red';

/** Paleta da seção 3 do plano: mesmo marshmallow, só a cor muda. */
export const PIPO_COLORS: Record<PipoColor, string> = {
  orange: '#FF8A3D',
  blue: '#4D8DFF',
  green: '#3DDC84',
  pink: '#FF5FA2',
  purple: '#A77BFF',
  yellow: '#FFD23F',
  cyan: '#3FD8E0',
  red: '#FF5A5A',
};

export const PIPO_COLOR_NAMES: Record<PipoColor, string> = {
  orange: 'laranja',
  blue: 'azul',
  green: 'verde',
  pink: 'rosa',
  purple: 'roxo',
  yellow: 'amarelo',
  cyan: 'ciano',
  red: 'vermelho',
};

export type PipoAccessory = 'none' | 'cap' | 'headset' | 'magnifier' | 'tie' | 'bow' | 'beanie' | 'glasses' | 'pencil';

/** Acessório do Pipo colorido → camada do mascote. */
export function pipoAccessoryLayers(a: PipoAccessory): Array<'headphones' | 'glasses' | 'cap' | 'magnifier' | 'tie' | 'bow' | 'beanie' | 'pencil'> {
  if (a === 'none') return [];
  if (a === 'headset') return ['headphones'];
  return [a];
}

export const PIPO_ACCESSORY_NAMES: Record<PipoAccessory, string> = {
  none: 'nenhum',
  cap: 'boné',
  headset: 'fone',
  magnifier: 'lupa',
  tie: 'gravata',
  bow: 'laço',
  beanie: 'gorro',
  glasses: 'óculos',
  pencil: 'lápis',
};

export interface PipoPersonality {
  /** Missão em uma frase ("Eu encontro leads e faço o primeiro contato"). */
  mission: string;
  /** Como escreve para terceiros e como fala com o usuário. */
  tone: string;
  /** O que ele nunca faz. */
  never: string[];
}

// ---------- Plano de execução ----------

export type StepKind = 'script' | 'http' | 'mcp' | 'sheet' | 'agent' | 'confirm' | 'branch' | 'notify' | 'handoff';

interface StepCommon {
  /** Identificador estável usado nos templates: {{passos.<key>.saida}}. */
  key: string;
  /** Nome legível ("Puxar leads do Apify"). */
  title: string;
  /** Tem efeito fora da máquina (envia e-mail, escreve na planilha…)? Exige confirmação ou "sempre permitir". */
  external?: boolean;
  /** Em caso de erro: parar (padrão) ou seguir. */
  onError?: 'stop' | 'continue';
}

export interface ScriptStep extends StepCommon {
  kind: 'script';
  /** Interpretador permitido: node, python, python3, powershell, pwsh, bash, sh. */
  command: string;
  /** O primeiro argumento é o arquivo dentro de scripts/ do Pipo. Aceita templates. */
  args: string[];
  /** Variáveis extras (aceita {{segredo.NOME}}). */
  env?: Record<string, string>;
  timeoutSec?: number;
}

export interface HttpStep extends StepCommon {
  kind: 'http';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  /** Corpo: string com templates; JSON se começar com { ou [. */
  body?: string;
  timeoutSec?: number;
}

export interface McpStep extends StepCommon {
  kind: 'mcp';
  /** Nome do servidor em pipos/<slug>/mcp.json. */
  server: string;
  tool: string;
  /** Argumentos (JSON com templates). */
  args: string;
}

export interface SheetStep extends StepCommon {
  kind: 'sheet';
  action: 'read' | 'append' | 'update';
  spreadsheetId: string;
  /** Aba!intervalo, ex.: "Leads!A:F". */
  range: string;
  /** Para append/update: template que vira uma lista de linhas (array de arrays ou de objetos). */
  rows?: string;
  /** Para update: coluna (cabeçalho) que identifica a linha. */
  keyColumn?: string;
}

export interface AgentStep extends StepCommon {
  kind: 'agent';
  prompt: string;
  model?: AgentModel;
  effort?: AgentEffort;
  /** Espera JSON na resposta (vira objeto na saída). */
  json?: boolean;
  /** Pode consultar outro Pipo (slug), profundidade 1. */
  askPipo?: string;
}

export interface ConfirmStep extends StepCommon {
  kind: 'confirm';
  message: string;
  /** Prévia (texto com templates). */
  preview?: string;
  /** Template de uma lista: vira aprovação em lote (carrossel). */
  list?: string;
}

export interface BranchStep extends StepCommon {
  kind: 'branch';
  /** Condição simples: "<template> <op> <valor>", op ∈ == != > < >= <=. */
  if: string;
  /** "end" encerra com sucesso; "goto:<key>" pula para um passo. */
  then: string;
}

export interface NotifyStep extends StepCommon {
  kind: 'notify';
  title: string;
  body?: string;
}

export interface HandoffStep extends StepCommon {
  kind: 'handoff';
  /** Pipo que recebe (slug). */
  to: string;
  /** Template do pacote entregue (vira {{entrada}} no outro Pipo). */
  payload: string;
  /** Disparar o outro Pipo já (respeitando o atraso do link) ou só deixar na caixa de entrada. */
  run: boolean;
}

export type PipoStep = ScriptStep | HttpStep | McpStep | SheetStep | AgentStep | ConfirmStep | BranchStep | NotifyStep | HandoffStep;

export interface MetricDef {
  key: string;
  label: string;
  /** Template que vira número ao fim da execução ("{{passos.enviar.saida.enviados}}"). */
  from: string;
  /** Ordem no funil (1, 2, 3…). Métricas com etapa formam um funil no dashboard. */
  stage?: number;
}

export interface PipoPlaybook {
  steps: PipoStep[];
  metrics: MetricDef[];
  limits: {
    /** Tempo máximo de uma execução. */
    maxRunMinutes: number;
    /** Janela de horário em que pode rodar (ex.: 08:00–18:00), ou null. */
    window?: { start: string; end: string } | null;
  };
  /** Quanto tempo manual cada execução economiza (o usuário informa). */
  savedMinutesPerRun?: number;
}

export const EMPTY_PLAYBOOK: PipoPlaybook = { steps: [], metrics: [], limits: { maxRunMinutes: 15, window: null } };

// ---------- Entidades ----------

export interface Pipo {
  id: number;
  slug: string;
  name: string;
  color: PipoColor;
  accessory: PipoAccessory;
  personality: PipoPersonality;
  model: AgentModel;
  effort: AgentEffort;
  paused: boolean;
  /** Roda em folga/férias/feriado? */
  runOnDaysOff: boolean;
  activeVersion: number | null;
  createdAt: string;
}

export interface PipoVersion {
  id: number;
  pipoId: number;
  version: number;
  playbook: PipoPlaybook;
  changelog: string;
  createdAt: string;
  approvedAt: string | null;
}

export type TriggerKind = 'manual' | 'schedule' | 'event' | 'after_pipo';

export interface ScheduleSpec {
  /** Como o usuário disse ("seg–sex 9h"). */
  text: string;
  /** Cron local de 5 campos. */
  cron: string;
}

export type EventSpec =
  | { type: 'email_label'; label: string }
  | { type: 'folder'; path: string }
  | { type: 'meeting_end' }
  | { type: 'webhook'; token: string };

export interface AfterPipoSpec {
  /** Slug do Pipo que vem antes. */
  from: string;
  delayMin: number;
}

export interface PipoTrigger {
  id: number;
  pipoId: number;
  kind: TriggerKind;
  spec: ScheduleSpec | EventSpec | AfterPipoSpec | Record<string, never>;
  enabled: boolean;
  lastFiredAt: string | null;
}

export type RunStatus = 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'waiting';

export interface PipoRun {
  id: number;
  pipoId: number;
  version: number;
  /** manual | schedule | chat | event | after:<slug> | rehearsal */
  trigger: string;
  status: RunStatus;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
  metrics: Record<string, number>;
  /** Execução de outro Pipo que entregou a entrada (handoff), se houver. */
  fromRunId: number | null;
  error: string | null;
}

export interface PipoRunStep {
  id: number;
  runId: number;
  key: string;
  title: string;
  kind: StepKind;
  status: StepStatus;
  startedAt: string | null;
  finishedAt: string | null;
  /** Saída resumida (sem segredos). */
  preview: string | null;
  error: string | null;
}

export interface PipoMemoryRule {
  id: number;
  pipoId: number;
  rule: string;
  source: string;
  createdAt: string;
}

/** Estado ao vivo de um Pipo para a pill e a Equipe. */
export type PipoLiveState = 'idle' | 'working' | 'waiting' | 'error' | 'done' | 'draft';

export interface PipoLive {
  pipoId: number;
  state: PipoLiveState;
  runId: number | null;
  /** "enviando 23/45" */
  stepLabel: string | null;
}

export interface PipoSummary extends Pipo {
  live: PipoLive;
  lastRun: PipoRun | null;
  nextRunAt: string | null;
  secrets: string[];
}

/** Rascunho do /criarpipo visto pelo chat (barra de progresso). */
export interface DraftInfo {
  conversationId: number | null;
  draftId: number;
  stage: 'start' | 'personality' | 'interview' | 'connections' | 'plan' | 'rehearsal' | 'hire';
  name: string | null;
  color: string | null;
  editing: boolean;
}

/** Modelo próprio do usuário ("Salvar como modelo" ou .pipo importado). */
export interface PipoModel {
  id: number;
  name: string;
  color: PipoColor;
  accessory: PipoAccessory;
  personality: PipoPersonality;
  playbook: PipoPlaybook;
  /** Nomes dos segredos que o modelo precisa (sem valores). */
  secrets: string[];
  createdAt: string;
}

/** "Prospector de Leads!" → "prospector-de-leads" */
export function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'pipo'
  );
}
