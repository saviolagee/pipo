# Pipo

Agente de IA de produtividade com mascote que vive no **topo central da tela**, numa ilha preta tipo
notch. Desktop (Windows + macOS), Electron + React 19 + TypeScript. O cérebro é o **Claude Code
logado com a sua assinatura** — sem chave de API.

- **Sempre visível:** a pill fica no topo da tela e expande ao passar o mouse, com transição elástica.
- **Sabe o que você está fazendo:** lê o app e o título da janela em foco (localmente) para registrar o
  tempo por cliente, proteger o foco e reagir ao contexto.
- **Tem emoção:** o humor do Pipo acompanha seu dia e sua semana; acessórios desbloqueiam com a sequência.
  O mascote é um boneco animado por código: pisca, olha em volta, acena, se espreguiça, pula e dá
  pirueta, com transição suave entre as expressões (`Ctrl+Alt+D` → Galeria mostra todas).
- **Interrompe pouco:** orçamento diário de interrupções (3/5/8). Fora dele, só muda de expressão.
- **Trilha de objetivos:** diga o resultado que você quer e até quando; o plano vira uma trilha com
  uma ação por dia. Dá para ajustar à mão (criar, editar, reordenar, mudar o dia, apagar) ou pedir ao
  Pipo no chat. Se uma ação fica para depois, as seguintes e a data final andam junto, sem punição;
  adiantou, a trilha chega mais cedo. O Início mostra a ação do dia; as horas ficam na revisão do dia.
- **Modo miniatura:** `Ctrl+Shift+M` encolhe o Pipo para uma bolinha no canto inferior direito, para
  liberar o topo da tela.
- **Equipe de Pipos coloridos:** crie ajudantes conversando (`/criarpipo` ou "quero um Pipo que…").
  Basta uma frase: o Opus planeja o Pipo inteiro, até o objetivo final, pesquisa referências quando
  é marketing, ensaia e mostra o plano com o botão Contratar. Cada um tem personalidade, cofre de
  segredos e um plano de execução fixo e versionado, que roda sob demanda, num horário, por evento
  ou depois de outro Pipo. Na pill, os mini-Pipos acendem enquanto trabalham. Veja
  [docs/pipos.md](docs/pipos.md).
- **Navegador:** os Pipos usam sites que não têm API (abrir, clicar, preencher, ler), cada um com a
  sua sessão; você faz o login uma vez na janela do navegador dele. No chat, o Pipo branco pesquisa
  na web, lê páginas e age em sites, pedindo confirmação antes de enviar qualquer coisa.
- **Site vira API:** na criação, o Pipo grava as chamadas internas de um site enquanto você o usa uma
  vez e passa a repeti-las direto, sem abrir navegador. A sessão fica no cofre e renova com um login.
- **Decisões com modelo local:** o passo `decide` escolhe entre opções (classificar, rotear, que
  link abrir). No começo decide o Claude, e cada decisão fica como exemplo daquela atividade. Com
  24 exemplos, o Pipo treina na sua máquina (CPU, sem instalar nada) um modelo só para ela, que
  responde em menos de 0,2 s sem gastar tokens e devolve para o Claude quando não tem certeza.
- **REA para os Pipos:** o servidor MCP de engenharia reversa
  ([morluto/rea](https://github.com/morluto/rea)) entra em qualquer Pipo com uma confirmação.
- **Dashboards:** horas vs meta, foco, distração, melhores horários, clientes (valor/hora), métricas
  dos Pipos e dinheiro (Stripe), com exportação CSV/PDF e "pergunte ao dashboard". Cada Pipo tem um
  painel próprio com o que ele produziu, falhas, custo em tokens e comparação entre períodos.
- **Dias não trabalhados:** folga, férias, doença e feriados (nacionais e estaduais) não quebram a
  sequência nem contam contra a meta.
- **Tempo de verdade:** só conta com movimento de mouse/teclado (vídeo parado na tela não conta;
  reunião conta).
- **Modelo configurável:** Sonnet por padrão, Opus/Haiku em Configurações e "Pensar mais" por resposta.
- **Chamar por voz (opcional):** diga "Pipo" para abrir o chat, ou "Pipo" e o nome de um Pipo da equipe
  para falar com ele. Liga em Configurações → Privacidade → Chamar por voz, com ajuste de sensibilidade.

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
| `Ctrl/Cmd+Shift+M` | Modo miniatura: o Pipo vira uma bolinha no canto inferior direito (de novo: volta ao topo) |
| `Ctrl/Cmd+Shift+A` | Abrir os dashboards |
| `Y` / `N` | Responder o card visível |
| `Esc` | Fechar o notch |
| `Ctrl+Alt+D` | Painel de debug do mascote (estados, humor, acessórios, simulações) |

Os quatro primeiros são configuráveis em Configurações → Atalhos.

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

O chamado por voz vem desligado. Ligado, o microfone fica aberto e só falas curtas são analisadas, por
um modelo de voz que roda na máquina (Whisper); nenhum áudio é gravado nem enviado. A escuta para em
reuniões e com o Pipo pausado, e um ícone de microfone no topo do notch mostra quando está ativa.

A referência visual está em [docs/referencia-visual.md](docs/referencia-visual.md). O plano da V2 está em
[docs/plano-v2.md](docs/plano-v2.md) e o guia dos Pipos coloridos em [docs/pipos.md](docs/pipos.md).
