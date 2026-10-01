import { join } from 'node:path';
import { app } from 'electron';

export const paths = {
  get userData(): string {
    return app.getPath('userData');
  },
  /** Anexos: única pasta que o agente pode ler com a ferramenta Read. */
  get files(): string {
    return join(app.getPath('userData'), 'files');
  },
  /** Diretório de trabalho isolado do `claude -p` (sem CLAUDE.md de outros projetos). */
  get workspace(): string {
    return join(app.getPath('userData'), 'agent-workspace');
  },
};

export const workspaceDir = (): string => paths.workspace;
