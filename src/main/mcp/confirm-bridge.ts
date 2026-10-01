// Ferramentas que alteram dados pedem confirmação no card "Ação proposta" (seção 3.5).
import type { Card, MascotState } from '@shared/types';
import { emit } from '../bus';
import { showCard } from '../cards';
import { db } from '../db';

const CONFIRM_TIMEOUT_MS = 2 * 60_000;

export function isAlwaysAllowed(tool: string): boolean {
  return !!db().get<{ always_allow: number }>('SELECT always_allow FROM tool_permissions WHERE tool_name = ? AND always_allow = 1', tool);
}

export function setAlwaysAllowed(tool: string, on: boolean): void {
  db().run('INSERT INTO tool_permissions (tool_name, always_allow) VALUES (?, ?) ON CONFLICT(tool_name) DO UPDATE SET always_allow = excluded.always_allow', tool, on);
}

export interface ConfirmSpec {
  subject: string;
  label?: string;
  title?: string;
  confirm?: string;
  cancel?: string;
  mascot?: MascotState;
  allowAlways?: boolean;
}

/** Mostra o card e aguarda Y/N. true = confirmado. */
export async function confirmAction(tool: string, spec: ConfirmSpec): Promise<boolean> {
  if (isAlwaysAllowed(tool)) return true;
  emit('mascot:react', { state: 'attention', ms: 1200 });
  const buttons: Card['buttons'] = [
    { id: 'no', label: spec.cancel ?? 'Recusar', kbd: 'N', variant: 'secondary' },
    { id: 'yes', label: spec.confirm ?? 'Confirmar', kbd: 'Y', variant: 'primary' },
  ];
  if (spec.allowAlways !== false) buttons.push({ id: 'always', label: 'Sempre permitir', variant: 'tertiary' });
  const answer = await showCard(
    { kind: 'action', glow: 'attention', mascot: spec.mascot ?? 'attention', label: spec.label ?? 'ação proposta', subject: spec.subject, title: spec.title, buttons },
    { timeoutMs: CONFIRM_TIMEOUT_MS, timeoutValue: 'no' },
  );
  if (answer === 'always') {
    setAlwaysAllowed(tool, true);
    return true;
  }
  return answer === 'yes';
}
