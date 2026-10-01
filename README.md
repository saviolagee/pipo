# Pipo

Agente de IA de produtividade com mascote que vive no **topo central da tela**, numa ilha preta tipo
notch. Desktop (Windows + macOS), Electron + React 19 + TypeScript. O cérebro é o **Claude Code
logado com a sua assinatura** — sem chave de API.

- **Sempre visível:** a pill fica no topo da tela e expande ao passar o mouse, com transição elástica.
- **Sabe o que você está fazendo:** lê o app e o título da janela em foco (localmente) para registrar o
  tempo por cliente, proteger o foco e reagir ao contexto.
- **Tem emoção:** o humor do Pipo acompanha seu dia e sua semana; acessórios desbloqueiam com a sequência.
- **Interrompe pouco:** orçamento diário de interrupções (3/5/8). Fora dele, só muda de expressão.
- **Equipe de Pipos coloridos:** crie ajudantes conversando (`/criarpipo`). Cada um tem personalidade,
  cofre de segredos e um plano de execução fixo e versionado, que roda sob demanda, num horário, por
  evento ou depois de outro Pipo. Na pill, os mini-Pipos acendem enquanto trabalham. Veja
  [docs/pipos.md](docs/pipos.md).
- **Dashboards:** horas vs meta, foco, distração, melhores horários, clientes (valor/hora), métricas
  dos Pipos e dinheiro (Stripe), com exportação CSV/PDF e "pergunte ao dashboard".
- **Dias não trabalhados:** folga, férias, doença e feriados (nacionais e estaduais) não quebram a
  sequência nem contam contra a meta.
- **Tempo de verdade:** só conta com movimento de mouse/teclado (vídeo parado na tela não conta;
  reunião conta).
- **Modelo configurável:** Sonnet por padrão, Opus/Haiku em Configurações e "Pensar mais" por resposta.

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

O workflow **build** do GitHub Actions testa e compila a cada push. Os instaladores (Windows, macOS e
Linux) saem ao criar uma tag `v*` ou em Actions → build → Run workflow, com um teste de fumaça que abre o
app empacotado e confere que a janela renderiza (`node scripts/smoke.mjs dist`).

Integrações (Google Agenda/Gmail, Spotify) e voz: veja [docs/integracoes.md](docs/integracoes.md).

## Atalhos

| Atalho | Ação |
|---|---|
| `Ctrl/Cmd+Shift+Space` | Abrir/fechar o notch |
| `Ctrl/Cmd+Shift+K` | Captura rápida (de novo com ela aberta: liga/desliga o microfone) |
| `Ctrl/Cmd+Shift+F` | Começar foco na próxima tarefa sugerida (também no botão ▶ da pill) |
| `Ctrl/Cmd+Shift+A` | Abrir os dashboards |
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
    music/         Spotify Web API e fallback (link / arquivo local); o Pipo dança com música
    days/          folgas, férias, feriados e as perguntas sobre dias sem registro
    pipos/         Pipos coloridos: repositório, cofre, executor de planos, /criarpipo (builder),
                   gatilhos (horário, eventos, webhook local), conexões, chat por Pipo, .pipo
    dashboard/     janela de dashboards e dados agregados
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

A referência visual está em [docs/referencia-visual.md](docs/referencia-visual.md). O plano da V2 está em
[docs/plano-v2.md](docs/plano-v2.md) e o guia dos Pipos coloridos em [docs/pipos.md](docs/pipos.md).
