# Pipo

Agente de IA de produtividade com mascote que vive no **topo central da tela**, numa ilha preta tipo
notch. Desktop (Windows + macOS), Electron + React 19 + TypeScript. O cérebro é o **Claude Code
logado com a sua assinatura** — sem chave de API.

- **Sempre visível:** a pill fica no topo da tela e expande ao passar o mouse, com transição elástica.
- **Sabe o que você está fazendo:** lê o app e o título da janela em foco (localmente) para registrar o
  tempo por cliente, proteger o foco e reagir ao contexto.
- **Tem emoção:** o humor do Pipo acompanha seu dia e sua semana; acessórios desbloqueiam com a sequência.
- **Interrompe pouco:** orçamento diário de interrupções (3/5/8). Fora dele, só muda de expressão.

## Rodando

Requisitos: Node 22+, e para o chat/IA o [Claude Code](https://code.claude.com/docs/en/setup) instalado e
logado (`claude` no terminal).

```bash
npm install
npm run dev          # app em desenvolvimento
npm test             # testes (vitest)
npm run typecheck
npm run dist:win     # instalador .exe (NSIS) — rodar no Windows
npm run dist:mac     # .dmg — rodar no macOS
```

Os instaladores também saem pelo workflow **build** do GitHub Actions (Actions → build → Run workflow,
ou ao criar uma tag `v*`): testa, empacota no Windows e no macOS e publica os artefatos.

Integrações (Google Agenda/Gmail, Spotify) e voz: veja [docs/integracoes.md](docs/integracoes.md).

## Atalhos

| Atalho | Ação |
|---|---|
| `Ctrl/Cmd+Shift+Space` | Abrir/fechar o notch |
| `Ctrl/Cmd+Shift+K` | Captura rápida (de novo com ela aberta: liga/desliga o microfone) |
| `Ctrl/Cmd+Shift+F` | Começar foco na próxima tarefa sugerida |
| `Y` / `N` | Responder o card visível |
| `Esc` | Fechar o notch |
| `Ctrl+Alt+D` | Painel de debug do mascote (estados, humor, acessórios, simulações) |

Os três primeiros são configuráveis em Configurações → Atalhos.

## Arquitetura

```
src/
  main/            processo principal (Node/Electron)
    agent/         ClaudeCodeProvider (claude -p + stream-json), provedor por API (opcional),
                   prompt de sistema, detecção/login do Claude, abrir/fechar o dia
    mcp/           servidor MCP "pipo": shim stdio (subido pelo Claude Code) ↔ socket local ↔
                   ferramentas no app; confirmação "Ação proposta" (Y/N, 2 min, Sempre permitir)
    activity/      tracker da janela em foco (5s), ociosidade, classificador, horas trabalhadas, CSV
    focus/         sessão de foco (pomodoro), rituais
    interruptions/ orçamento, intervalo mínimo, fila, prioridades, silenciamento
    insights/      humor, sequência/acessórios, padrões semanais, reações ao contexto
    integrations/  OAuth loopback + PKCE, Google Agenda, Gmail
    music/         Spotify Web API e fallback (link / arquivo local)
    db/            SQLite (node:sqlite do Electron) com migrações versionadas
  preload/         ponte tipada (contextBridge)
  shared/          tipos, contrato de IPC, parser de linguagem natural, sugestão de tarefa
  renderer/        React: notch, pill, mascote (SVG + Motion), telas, voz (Whisper local)
```

Decisões que diferem do plano original (e por quê):

- **SQLite via `node:sqlite`** (embutido no Electron 44 / Node 24) em vez de `better-sqlite3`: mesma API
  síncrona, sem módulo nativo para recompilar por plataforma/versão do Electron.
- **Google/Spotify via `fetch`** em vez do pacote `googleapis`: só usamos 5 endpoints REST; evita ~100 MB.
- **Parser de datas próprio em pt-BR** em vez do `chrono-node`: o chrono não entende "10h", "de manhã",
  "dia 15", "em 3 dias", "semana que vem".
- **Ferramentas MCP via shim + socket:** o processo que o Claude Code sobe é um repasse fino; as
  ferramentas rodam no app (acesso ao banco e à confirmação no notch).

## Privacidade

Tudo fica na máquina. Títulos de janela **não** vão para o Claude — só agregados (app, cliente, duração);
títulos crus apenas quando você pede explicitamente ("o que eu fiz ontem à tarde?"), com confirmação.
Configurações → Privacidade: pausar o registro, apps ignorados, apagar histórico.

A referência visual está em [docs/referencia-visual.md](docs/referencia-visual.md). Próximos passos: [docs/plano-v2.md](docs/plano-v2.md) (equipe de Pipos coloridos).
