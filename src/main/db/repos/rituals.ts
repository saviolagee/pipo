import type { MusicConfig, Ritual, RitualConfig } from '@shared/types';
import { db } from '../index';

interface RitualRow {
  id: number;
  kind: Ritual['kind'];
  label: string;
  enabled: number;
  config_json: string;
  position: number;
}

const toRitual = (r: RitualRow): Ritual => ({
  id: r.id,
  kind: r.kind,
  label: r.label,
  enabled: !!r.enabled,
  config: JSON.parse(r.config_json) as RitualConfig,
  position: r.position,
});

export function listRituals(): Ritual[] {
  return db().all<RitualRow>('SELECT * FROM rituals ORDER BY position, id').map(toRitual);
}

/** Substitui a lista inteira de rituais (onboarding e Configurações editam o conjunto). */
export function saveRituals(items: Omit<Ritual, 'id'>[]): Ritual[] {
  db().tx(() => {
    db().run('DELETE FROM rituals');
    items.forEach((r, i) => {
      db().run('INSERT INTO rituals (kind, label, enabled, config_json, position) VALUES (?, ?, ?, ?, ?)', r.kind, r.label, r.enabled, JSON.stringify(r.config ?? {}), i);
    });
  });
  return listRituals();
}

export function musicRitual(): (Ritual & { config: MusicConfig }) | null {
  const r = listRituals().find((x) => x.kind === 'music' && x.enabled);
  return r ? (r as Ritual & { config: MusicConfig }) : null;
}
