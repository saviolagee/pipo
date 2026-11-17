// Memória da equipe: o que um Pipo aprende sobre o usuário e o negócio, todos passam a saber.
import { factKey, factsBlock, MAX_FACT_CHARS, MAX_FACTS, type TeamFact } from '@shared/team';
import { db } from '../db';

interface Row {
  id: number;
  text: string;
  source: string;
  created_at: string;
}

const toFact = (r: Row): TeamFact => ({ id: r.id, text: r.text, source: r.source, createdAt: r.created_at });

export function listFacts(): TeamFact[] {
  return db().all<Row>('SELECT * FROM team_facts ORDER BY id').map(toFact);
}

/** Guarda um fato (sem repetir). Passando do limite, o mais antigo sai. */
export function addFact(text: string, source = 'chat'): TeamFact {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, MAX_FACT_CHARS);
  if (!clean) throw new Error('Fato vazio.');
  const key = factKey(clean);
  const same = listFacts().find((f) => factKey(f.text) === key);
  if (same) return same;
  const { lastId } = db().run('INSERT INTO team_facts (text, source, created_at) VALUES (?, ?, ?)', clean, source, new Date().toISOString());
  const all = listFacts();
  for (const old of all.slice(0, Math.max(0, all.length - MAX_FACTS))) deleteFact(old.id);
  return listFacts().find((f) => f.id === lastId) as TeamFact;
}

export function deleteFact(id: number): void {
  db().run('DELETE FROM team_facts WHERE id = ?', id);
}

/** Apaga o fato que mais parece com o texto dado ("esquece que eu atendo médicos"). */
export function forgetFact(text: string): TeamFact | null {
  const words = factKey(text).split(' ').filter((w) => w.length > 2);
  if (!words.length) return null;
  let best: { fact: TeamFact; score: number } | null = null;
  for (const fact of listFacts()) {
    const k = factKey(fact.text);
    const score = words.filter((w) => k.includes(w)).length / words.length;
    if (score >= 0.6 && (!best || score > best.score)) best = { fact, score };
  }
  if (best) deleteFact(best.fact.id);
  return best?.fact ?? null;
}

/** Bloco pronto para entrar num prompt ('' quando ainda não há nada). */
export function factsText(): string {
  try {
    return factsBlock(listFacts());
  } catch {
    // Banco de uma versão antiga, ainda sem a tabela: segue sem a memória.
    return '';
  }
}
