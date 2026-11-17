// Catálogo da loja de Pipos: cada item é um Pipo pronto (personalidade, plano, scripts e o que
// perguntar ao usuário na instalação).
import type { PipoAccessory, PipoColor, PipoPersonality, PipoPlaybook } from '@shared/pipos';
import type { StoreField } from '@shared/team';
import type { AgentEffort, AgentModel } from '@shared/types';

export interface StoreDef {
  id: string;
  name: string;
  tagline: string;
  does: string[];
  color: PipoColor;
  accessory: PipoAccessory;
  model: AgentModel;
  effort: AgentEffort;
  personality: PipoPersonality;
  /** Apresentação do Pipo no chat dele, logo depois de instalado. */
  intro: string;
  /**
   * O que o usuário preenche. 'secret' vai para o cofre do Pipo (a chave é o nome do segredo);
   * "agenda" vira o horário de rodar; o resto vai para data/config.json, que os scripts leem.
   */
  fields: StoreField[];
  /** Arquivos copiados para a pasta do Pipo (scripts/…). */
  files: Record<string, string>;
  playbook: PipoPlaybook;
}

/** Campo que vira o gatilho de horário em vez de ir para a configuração. */
export const SCHEDULE_FIELD = 'agenda';
