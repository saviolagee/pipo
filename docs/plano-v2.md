# PLANO V2 — Equipe de Pipos

A V1 entregou o Pipo branco: notch, mascote, tarefas, foco, atividade, integrações e o agente via
Claude Code. A V2 transforma o Pipo numa **equipe**. O Pipo branco continua como o coordenador, e cada
**Pipo colorido** é um agente especializado que executa um processo fixo, montado conversando com ele.

**Nenhum Pipo colorido vem instalado.** O app entrega a **estrutura** (criação por conversa, executor,
gatilhos, conectores genéricos, conexão entre Pipos, visual e métricas). Cada Pipo é criado pelo
usuário dentro do app. O Prospector abaixo é só o caso de teste que prova que a estrutura aguenta um
fluxo real.

Mesmas regras da V1:

- **Ordem e commits:** fases em ordem, cada uma validada pelo seu aceite e commitada como
  `feat(fase-N): ...`. A numeração continua da V1.
- **Visual = funcionalidade:** o visual tem o mesmo peso da funcionalidade.
- **Código:** TypeScript estrito, sem `any`.
- **Textos:** textos de interface em `src/renderer/i18n/pt-BR.ts`.
- **Flags do CLI:** confirmadas em `claude --help` antes de usar. Versão de referência: 2.1.287.

---

## 0. Exemplo-guia: Pipo Prospector (criado pelo usuário, não nativo)

É o caso que guia as decisões e o teste de aceite. O app não traz nada específico dele: nem conector
do Apify, nem do Resend, nem modelo pronto. Se o usuário conseguir criá-lo do zero pelo `/criarpipo` e
ele funcionar ponta a ponta, a estrutura está pronta.

> "Pipo, cria um Pipo prospector: ele roda meu script que puxa e-mails do Apify, manda a sequência
> pelo Resend, atualiza a planilha de leads e me avisa."

1. **Montagem no chat.** O usuário digita `/criarpipo` e descreve o que quer. O Pipo branco
   entrevista o usuário: onde está o script, qual actor do Apify, qual template de e-mail, qual
   planilha e qual coluna marca "enviado".
2. **Rascunho.** O Pipo propõe o **processo**, uma lista de passos.
3. **Ensaio.** Ele roda cada passo em modo seco: puxa os leads, mostra 3 e-mails renderizados e simula
   a atualização da planilha.
4. **Fixação.** O usuário aprova e o processo vira a **versão 1** do Pipo Prospector (cor laranja).
5. **Disparo.** A partir daí ele roda quando o usuário define ("seg–sex às 9h"), quando o usuário pede
   ("@prospector roda agora") ou pelo botão.
6. **Durante a execução.** O mini-Pipo laranja fica **aceso** na pill.
7. **No fim.** Aparece um card:

   > "Prospector: 48 leads novos, 45 e-mails enviados, 3 inválidos, planilha atualizada."

8. **Ajustes depois.** O usuário conversa com o Prospector no chat dele: "por que 3 falharam?",
   "a partir de amanhã, manda no máximo 30". Uma mudança no processo gera a versão 2, com diff e
   confirmação.

---

## 1. Modelo do agente

**Hoje:** o `ClaudeCodeProvider` não passa `--model`, então vale o modelo do Claude Code do usuário.

**Na V2:**

- **Padrão `sonnet`.** O alias resolve para o Sonnet mais recente (Sonnet 5.5 hoje). É mais rápido e
  gasta menos do limite da assinatura.
- **Configurações → Agente → Modelo:**
  - Sonnet (padrão)
  - Opus (mais capaz)
  - Haiku (mais rápido)
  - "Mesmo do terminal" (não passa `--model`)
- **Effort:** `--effort` com `low`, `medium` ou `high`. O padrão é `medium`.
- **Botão "Pensar mais"** no chat: refaz a última resposta com `--model opus --effort high`.
- **Modelo por Pipo:** cada Pipo colorido pode ter modelo e effort próprios, e cada passo `agent` pode
  sobrescrever (ex.: Haiku para classificar, Sonnet para escrever).
- **Fallback:** sempre passar `--fallback-model` com a lista seguinte. Sonnet cai para Haiku; Opus cai
  para Sonnet e depois Haiku.
- **Modelo visível:** o modelo usado aparece discreto no rodapé de cada resposta. O valor sai do evento
  `system/init` do stream-json, não do que foi pedido.
- **Provedor por API:** passa a ter o mesmo seletor. O padrão vira `claude-sonnet-5-5`.

---

## 2. Conceito: Pipo colorido

Um Pipo é um agente com identidade e um **processo fixo versionado**.

| Campo | Exemplo |
|---|---|
| nome, cor, acessório | Prospector, laranja, boné |
| descrição | "Prospecção fria por e-mail" |
| instruções | prompt próprio, anexado ao prompt de sistema base |
| processo (playbook) | lista de passos, com versões v1, v2… |
| gatilhos | manual, agenda, chat, evento |
| permissões | quais scripts, ferramentas MCP e pastas ele pode usar |
| segredos | `APIFY_TOKEN`, `RESEND_API_KEY` (cofre, nunca no prompt) |
| limites | máx. 50 e-mails/execução, só entre 8h e 18h, timeout de 15 min |
| memória | aprendizados ("não mandar para domínios .gov") |
| modelo / effort | sonnet / medium |

O Pipo branco é o **coordenador**. Ele conversa com o usuário, cria e edita os outros Pipos, delega
pedidos ("roda o prospector") e junta os relatórios no resumo do dia.

### 2.1 Passos do processo

O processo é **determinístico onde dá** e usa o agente só onde precisa de julgamento. Isso garante que
o "processo fixo" se repita igual toda vez.

| Tipo | O que faz | Quem executa |
|---|---|---|
| `script` | roda um comando (node/python/ps1) da pasta do Pipo com args, env e timeout; captura stdout JSON | executor do app, direto via `child_process` |
| `http` | chamada HTTP genérica (método, URL, headers, corpo) com segredos do cofre; serve para qualquer API (Apify, Resend…) sem conector específico | executor do app |
| `mcp` | chama uma ferramenta de um servidor MCP que o usuário adicionou ao Pipo (ex.: o MCP oficial de um serviço) | executor do app via cliente MCP |
| `sheet` | ler, acrescentar ou atualizar linhas no Google Sheets (usa o login Google da V1) | executor do app |
| `handoff` | entrega dados para outro Pipo e, opcionalmente, dispara ele (seção 2.5) | executor do app |
| `agent` | prompt ao Claude com as saídas dos passos anteriores (ex.: personalizar o e-mail, classificar leads) | `claude -p` com as permissões do Pipo |
| `confirm` | pede Y/N ao usuário, com prévia (ex.: "enviar 45 e-mails?") | card no notch |
| `branch` | condição simples sobre a saída anterior (`leads.length == 0` → encerra) | executor |
| `notify` | card, som ou notificação do sistema | executor |

- **Saídas:** cada passo grava a saída em `runs/<id>/<passo>.json`. Os passos seguintes referenciam
  `{{passos.puxar.saida.leads}}`.
- **Resumo final:** um passo `agent` com Haiku escreve o card a partir dos números.

### 2.2 Segurança (inegociável)

- **Bash restrito.** Um Pipo só roda os scripts da própria pasta. Quando um passo `agent` precisa de
  shell, ele recebe `--allowedTools` com padrões exatos, como `Bash(node scripts/puxar.js:*)`. Nunca
  `Bash` livre.
- **Segredos.** Ficam no cofre (`safeStorage`) e são injetados como variáveis de ambiente só no
  processo do passo. Não vão para o prompt nem para os logs (máscara automática no stdout).
- **Ações externas.** Enviar e-mail, escrever na planilha ou postar exige um passo `confirm` na
  primeira versão. O usuário pode trocar por "sempre permitir" por Pipo e por passo, com limite
  numérico obrigatório.
- **Modo seco.** Todo passo `http` ou `script` recebe `PIPO_DRY_RUN=1` e precisa respeitar. O ensaio
  da montagem sempre roda nesse modo.
- **Pausa automática.** 3 falhas seguidas pausam o Pipo e avisam o usuário. Há um botão "parar tudo"
  na bandeja.
- **Mudanças no processo.** Toda mudança mostra o diff e pede confirmação. O agente nunca altera o
  processo fixado sozinho.

### 2.3 `/criarpipo` — nascer conversando

Todo Pipo novo nasce numa conversa com o Pipo branco. A conversa define a **personalidade** (o que ele
faz e como) e termina num **plano de execução** que ele vai repetir.

Comandos no chat do branco (autocompletar ao digitar `/`):

| Comando | Faz |
|---|---|
| `/criarpipo` | começa a criação de um Pipo novo |
| `/editarpipo <nome>` | reabre a conversa de criação para mudar personalidade ou plano (gera nova versão) |
| `/equipe` | lista a equipe com status |
| `/rodar <nome>` | dispara uma execução (equivale a `@nome roda`) |
| `/pausar <nome>` | pausa as execuções agendadas |

**Etapas da criação.** Uma barra de progresso discreta no topo do chat mostra a etapa atual.

1. **Ponto de partida.**
   - O usuário descreve o que quer em linguagem livre ("quero um Pipo que cobra cliente atrasado").
   - Se a pessoa travar, o branco mostra alguns chips de ideia (seção 2.4). São só frases para
     inspirar: clicar preenche a primeira mensagem, nada vem pré-montado.
   - Se o usuário já salvou um Pipo como modelo próprio ou importou um `.pipo`, ele aparece aqui como
     ponto de partida.
2. **Personalidade.**
   - Nome, cor, acessório e a missão em uma frase ("Eu encontro leads e faço o primeiro contato").
   - Tom: como ele escreve para terceiros e como fala com o usuário.
   - O que ele **nunca** faz.
   - O mini-Pipo já aparece na pill, em "rascunho" (contorno tracejado), e vai ganhando a cor e o
     acessório conforme o usuário escolhe.
3. **Entrevista.**
   - O roteiro da entrevista é genérico e vale para qualquer Pipo: gatilho, de onde vêm os dados, o
     que fazer com eles, para onde vai o resultado, limites, quando avisar, quando pedir permissão, se
     roda em folgas/férias e se conversa com outro Pipo.
   - O branco só avança quando cada item do roteiro tem resposta ou foi marcado como "não se aplica".
   - O branco pergunta **uma coisa por vez** e aceita respostas soltas.
   - Arquivos podem ser arrastados para a conversa: script existente, planilha modelo, exemplo de
     e-mail.
4. **Conexões.**
   - O branco pede os segredos e logins que faltam. Para serviços sem conector, ele monta passos
     `http` lendo a documentação da API que o usuário colar ou indicar, ou sugere adicionar o servidor
     MCP do serviço.
   - Segredos entram por um campo seguro no notch (`request_secret`), nunca pelo texto do chat.
   - Logins OAuth (Google etc.) abrem o fluxo já existente da V1.
5. **Plano de execução.**
   - O branco mostra o plano como um card legível, com os passos numerados, o tipo de cada um, o que
     precisa de confirmação, os limites e os gatilhos.
   - O usuário ajusta conversando ("tira o passo 3", "manda no máximo 30").
6. **Ensaio.**
   - Execução completa em modo seco, com prévia de tudo que seria enviado ou escrito.
   - Se algo falhar, o branco corrige junto com o usuário e ensaia de novo.
7. **Contratar.**
   - Botão "Contratar Pipo" (ou Y).
   - O plano vira a **v1**, o Pipo ganha cor cheia e cai na pill com uma animação de entrada.
   - Ele entra na aba Equipe e se apresenta no próprio chat ("Oi, sou o Prospector. Rodo seg–sex às
     9h. Me chama com @prospector").

**Rascunho persistente.** Se a conversa parar no meio, o rascunho fica salvo. `/criarpipo` pergunta
"continuar o Prospector que começamos ontem?".

**Plano de execução como contrato.** O que o Pipo repete é **só** o plano fixado. A personalidade
orienta os passos `agent` (tom, critérios), mas não adiciona passos novos. Qualquer mudança passa por
`/editarpipo` e vira uma nova versão.

### 2.4 Estrutura pronta, sem Pipos nativos

O app vem **preparado para receber qualquer Pipo**, mas não traz nenhum montado. O que vem pronto:

- **Roteiro genérico de entrevista** (seção 2.3) e prompt de sistema do branco especializado em
  transformar conversa em plano de execução.
- **Tipos de passo genéricos** (seção 2.1): `script`, `http`, `mcp`, `sheet`, `agent`, `confirm`,
  `branch`, `notify` e `handoff`.
- **Cofre de segredos por Pipo** e campo seguro para pedir chaves.
- **Gatilhos:** manual, agenda, chat, evento e "depois de outro Pipo".
- **Métricas declaradas:** no plano, o Pipo declara o que conta (ex.: `leads`, `enviados`,
  `respondidos`). Os dashboards montam os gráficos a partir disso, sem código específico por Pipo. Se
  as métricas forem marcadas como etapas, viram um funil automaticamente.
- **Visual:** paleta, acessórios e estados.

**Chips de ideia.** São só texto, para inspirar quem não sabe por onde começar:

- "Prospectar leads e mandar o primeiro e-mail"
- "Cobrar quem não respondeu depois de 3 dias"
- "Mandar relatório de horas para o cliente toda sexta"
- "Organizar minha caixa de entrada de manhã"
- "Me avisar das cotações da minha carteira"
- "Pesquisar uma empresa antes da reunião"

**Modelos do próprio usuário.** Qualquer Pipo contratado pode ser salvo como modelo ("Salvar como
modelo") ou exportado como `.pipo` (sem segredos). Esses modelos aparecem como ponto de partida no
`/criarpipo`.

### 2.5 Conexão entre Pipos

Um Pipo pode trabalhar em cima do resultado de outro.

- **Encadear:** o gatilho "depois de" faz o Pipo B rodar quando o Pipo A termina com sucesso, na hora
  ou com atraso ("3 dias depois").
- **Entregar dados:** o passo `handoff` do A envia um pacote (ex.: a lista de leads enviados) para a
  caixa de entrada do B. O B lê o pacote como entrada da execução: `{{entrada.leads}}`.
- **Pedir ajuda:** um passo `agent` pode consultar outro Pipo ("@pesquisador, resume essa empresa") e
  esperar a resposta. Isso só vale com limite de profundidade 1: um Pipo chamado não chama um terceiro.
- **Configurar:** na criação, o roteiro pergunta "esse Pipo depende de outro?". Também dá para
  configurar depois com `/editarpipo` ou arrastando um Pipo sobre o outro na aba Equipe.
- **Ver a conexão:**
  - na pill, quando o A entrega para o B, uma luz corre do mini-Pipo A até o B, e o B acende;
  - na aba Equipe, um mapa simples mostra as setas entre os Pipos;
  - na execução do B aparece "veio do Prospector, execução de ontem 9h".
- **Segurança:**
  - sem ciclos: o app recusa A → B → A;
  - cada Pipo continua com as próprias permissões e segredos, e o pacote entregue não carrega
    segredos;
  - se o A falhar, o B não roda.

---

## 3. Visual

- **Paleta de 8 cores:**
  - laranja `#FF8A3D`
  - azul `#4D8DFF`
  - verde `#3DDC84`
  - rosa `#FF5FA2`
  - roxo `#A77BFF`
  - amarelo `#FFD23F`
  - ciano `#3FD8E0`
  - vermelho `#FF5A5A`

  Mesmo corpo marshmallow, só a cor muda. Os olhos continuam pretos.
- **Pill reduzida.** À direita do Pipo branco ficam os **mini-Pipos** coloridos, em 12px, até 4
  visíveis e depois "+2".
  - **Apagado:** cor a 30% e olhos fechados. O Pipo está ocioso.
  - **Aceso:** cor cheia, glow suave da própria cor e olhos piscando/olhando. Está trabalhando.
  - **Esperando você:** aceso com um pulso lento e um ponto branco. Há um `confirm` pendente.
  - **Erro:** um ponto vermelho, sem chacoalhar (sem drama).
  - **Concluiu:** pulinho e 1s de brilho, depois apaga.
- **Hover em um mini-Pipo:** tooltip com o passo atual ("Prospector · enviando 23/45").
- **Clique em um mini-Pipo:** expande o notch direto na execução dele.
- **Aba "Equipe" no notch expandido.** Cartões dos Pipos com status, última execução, próxima execução,
  botões ▶ Rodar / ⏸ Pausar e acesso ao chat.
- **Tela de execução.** Linha do tempo vertical dos passos (✓ / ⟳ / ✕) com duração e saída resumida.
  Dá para expandir o log bruto.
- **Chat.** Um seletor de Pipo no topo do chat. Também dá para usar `@prospector` no chat do branco,
  que delega e mostra a resposta com a cor do Pipo. Cada Pipo tem a própria conversa (`--resume`
  próprio).
- **Acessórios por Pipo.** Boné, fone, lupa, gravata… escolhidos na criação. Os desbloqueios de
  sequência da V1 continuam só no branco.

### 3.1 Ajustes no Pipo branco (vindos do uso da V1)

**Luz embaixo do notch, não no meio da tela.**

- **Problema:** o glow (`src/renderer/notch/Glow.tsx`) é um retângulo que começa no topo da janela e
  cresce junto com o notch (altura + 150px). O centro do gradiente fica a 72% dessa altura. Com o
  notch expandido (até ~600px), a luz cai no meio da tela em vez de sair de baixo da ilha.
- **Correção:**
  - ancorar o glow na **borda de baixo** do notch, centrado nela;
  - altura fixa de vazamento (~70px para baixo), que não cresce com a altura do notch;
  - a largura acompanha a do notch, com a mesma mola;
  - um pouco de luz nas laterais só quando o notch está expandido;
  - nada de brilho atrás do conteúdo do card.
- **Aceite:** capturas com o notch colapsado e expandido mostram a luz colada embaixo da ilha, até
  ~80px abaixo dela, e nenhum brilho no meio da tela.

**Botão fácil para focar na próxima tarefa.** Hoje o caminho é o atalho `Ctrl/Cmd+Shift+F`, o botão
"Começar foco" do Início ou o botão de cada tarefa.

- **Início:**
  - o primeiro botão passa a ser **"▶ Focar: <próxima tarefa> · 25 min"**, com o nome da tarefa
    sugerida;
  - 1 clique começa o foco;
  - uma setinha ao lado abre a escolha de outra tarefa ou de outra duração.
- **Pill:** com o notch fechado e sem foco ativo, um **▶** discreto fica à direita do mascote. Passar
  o mouse expande o notch já com o botão "Focar" em destaque. Do notch fechado até o foco são no
  máximo 2 gestos (passar o mouse e clicar).
- **Bandeja:** o primeiro item do menu passa a ser "▶ Focar na próxima: <tarefa>".
- **Tarefas:** um botão "Focar na próxima" no topo da lista. O ▶ aparece em cada linha ao passar o
  mouse.
- **Depois de concluir:** o card de concluído oferece "Próxima: <tarefa> ▶".
- **Chat e voz:** "foca na próxima" começa direto, sem confirmação.
- **Aceite:** com o notch fechado, começar o foco na próxima tarefa leva no máximo 2 gestos e
  nenhuma tecla.

**Pipo dança quando tem música.**

- **Detecção:** uma leitura a cada 5s, sempre local e sem gravar nada. As fontes, em ordem:
  1. Spotify Web API, se o Spotify estiver conectado (a cada 15s);
  2. título da janela do app do Spotify, que mostra "Artista - Faixa" enquanto toca; funciona sem
     conectar nada;
  3. arquivo local do ritual de foco.
- **Privacidade:** a leitura de janela respeita "pausar registro" e a lista de apps ignorados.
- **Estado `dancing`:** balanço lado a lado com quique a ~120 bpm, olhos felizes (^ ^), mãozinhas
  alternadas, notas musicais subindo e fone automático.
- **Prioridade:** a dança perde para card, agente, voz, reunião e Pipo pausado. Ela ganha de foco,
  sono e idle.
- **Configuração:** a opção "Dançar com música" fica em Configurações → Reações e vem ligada.
- **Chip do Spotify:** passa a mostrar a faixa sempre que estiver tocando, não só durante o foco.
- **Aceite:**
  - tocar algo no Spotify → em até 5s o Pipo dança na pill e no Início;
  - pausar → ele para;
  - entrar numa reunião → ele fica em `shh`.

---

## 4. Análises e dashboards

Três frentes: suas ações, as ações dos Pipos e os dias em que você não trabalhou. Tudo aparece na
janela de dashboards (seção 4.3).

### 4.1 Análise das suas ações (produtividade, aprofunda a V1)

- **Visão de semana e mês:** horas por cliente e tipo de tarefa, foco vs. distração, metas batidas,
  tarefas adiadas e tendência do humor.
- **Pergunta livre:** "onde foi meu tempo em setembro?" O agente consulta só agregados. Títulos crus
  continuam exigindo confirmação.
- **Rentabilidade por cliente:** horas × valor/hora cadastrado vs. valor do contrato.
- **Relatório semanal automático** na sexta, como card e, opcionalmente, como e-mail para o próprio
  usuário.

### 4.2 Análise das ações dos Pipos (o que a equipe fez)

- **Auditoria:** cada execução fica com passos, entradas, saídas, duração, quem disparou e versão do
  processo.
- **Métricas por Pipo:** execuções, taxa de sucesso, duração média e tempo economizado estimado
  (o usuário informa "isso me levava X min").
- **Métricas declaradas:** cada Pipo mostra as métricas que declarou no plano (seção 2.4). Se elas
  formam etapas, o dashboard monta um funil (ex.: leads → enviados → respondidos) e compara as
  versões do processo. Nada disso é específico de um Pipo.
- **Pergunta livre:** "qual versão do meu Prospector teve mais resposta?"

### 4.3 Janela de dashboards

O notch é pequeno demais para gráficos. Os dashboards abrem numa **janela normal** (redimensionável,
tema escuro do Pipo).

- **Como abrir:**
  - "Ver dashboard" no notch;
  - atalho `Ctrl/Cmd+Shift+A`;
  - item "Dashboards" na bandeja;
  - links dos cards ("ver detalhes").
- **Hoje:** horas vs. meta (anel grande), linha do tempo do dia por app/cliente, focos concluídos,
  tarefas feitas e o que os Pipos fizeram hoje.
- **Semana / Mês:**
  - horas por dia (barras, com a meta como linha e as ausências marcadas);
  - foco vs. distração;
  - top distrações;
  - tarefas concluídas vs. criadas;
  - humor ao longo do tempo.
- **Ano:** mapa de calor estilo GitHub com as horas trabalhadas por dia.
  - Folgas, férias e feriados aparecem com cor própria (não como "zero").
  - A sequência atual e o recorde ficam visíveis.
- **Ritmo:** mapa de calor dia da semana × hora do dia, para mostrar quando você rende mais. Alimenta o
  "melhor horário" da V1.
- **Clientes:**
  - horas por cliente no período;
  - comparação com o contratado;
  - valor/hora efetivo;
  - tendência.
- **Equipe:** execuções por Pipo, taxa de sucesso, tempo economizado acumulado e as últimas falhas.
- **Métricas dos Pipos:** gráficos e funis montados a partir das métricas declaradas de cada Pipo,
  com filtro por versão do processo.
- **Exportar:** CSV de qualquer visão e PDF do relatório. Um Pipo do usuário também pode usar o PDF
  como passo.
- **Pergunte ao dashboard:** um campo "pergunte sobre esses dados". O agente responde com base nos
  agregados da visão aberta e pode destacar um ponto no gráfico.

### 4.4 Dias não trabalhados

Hoje um dia útil sem atividade conta como dia ruim: derruba o humor e quebra a sequência. A V2 entende
ausências.

- **Tipos:**
  - folga;
  - férias;
  - feriado;
  - doente;
  - meio período (meta pela metade);
  - "trabalhei fora do PC" (horas informadas manualmente).
- **Feriados automáticos:**
  - nacionais do Brasil, calculados localmente (Páscoa, Carnaval e Corpus Christi incluídos);
  - estaduais e municipais opcionais, escolhidos pela cidade no perfil;
  - o usuário marca quais costuma trabalhar mesmo assim.
- **Detecção:** um dia útil sem atividade gera, no dia seguinte, uma pergunta leve:

  > "Ontem não te vi. Foi folga?"

  Opções: [Folga] [Doente] [Trabalhei fora do PC] [Esqueci de abrir o Pipo].

  É **uma** pergunta, que conta como expressão, não como interrupção. Se a pergunta não for respondida,
  o dia fica "sem registro".
- **Efeitos de uma ausência:**
  - não quebra a sequência;
  - não entra nas médias de humor nem de horas;
  - a meta do dia é zero;
  - o Pipo não interrompe.
  - O mascote fica de "pijama", com um acessório de folga, se o usuário abrir o PC.
- **Férias planejadas:**
  - `/ferias 10 a 20 de dez` ou um seletor no dashboard;
  - 3 dias antes, o branco sugere fechar pendências e mostra o que vence no período;
  - durante as férias, os Pipos seguem a regra de cada um ("rodar também nas férias?", perguntado na
    criação);
  - na volta, um card "enquanto você estava fora" com o que os Pipos fizeram, os e-mails importantes e
    o que vence esta semana.
- **Trabalho em dia de folga:**
  - as horas contam como extra, com marcação própria no dashboard;
  - não aumentam a meta nem "compensam" outro dia;
  - se virar padrão (3 fins de semana seguidos), o Pipo comenta uma vez, com carinho.
- **Saldo:** no dashboard Ano aparecem os dias trabalhados, as folgas, as férias usadas e as horas
  extras do ano.

---

## 5. O que mais pode ter (backlog priorizado)

**Alta — entram na V2:**

- **Gatilhos por evento:**
  - e-mail novo com marcador X;
  - arquivo novo numa pasta;
  - fim de reunião;
  - webhook local (`127.0.0.1`).
- **Aprovação em lote:** um passo `confirm` com lista (ex.: 45 e-mails) vira um carrossel, onde dá para
  editar um item e pular outro.
- **Memória por Pipo:** o usuário corrige no chat ("não manda pra concorrente X") e isso vira regra
  persistente, visível e editável.

**Média:**

- **Ata de reunião local:**
  - O Whisper da V1 transcreve a reunião, só com consentimento explícito e um aviso visível enquanto
    grava.
  - No fim, o branco gera a ata e as tarefas, e pergunta antes de criar.
- **Avisos no celular:** notificação via Telegram (bot próprio) ou ntfy quando o usuário está longe do
  PC. Responder pelo Telegram dispara o Pipo ("/prospector rodar").
- **Ciência do limite da assinatura:** ler os eventos `rate_limit_event` do stream-json. Perto do
  limite, adiar execuções não urgentes e avisar.
- **Autoconserto:** quando um script falha, o Pipo lê o erro, propõe um patch (diff) e só aplica com
  Y. Isso gera uma nova versão.
- **Horário comercial por Pipo** e fila: execuções fora da janela esperam.
- **Projetos com marcos:** metas maiores que tarefas ("lançar site até 30/11"), com progresso no
  dashboard. O "Planejar meu dia" puxa o próximo marco.
- **Check-in de energia:** 1 clique no fim do foco (😴 / 🙂 / 🔥). O dashboard Ritmo cruza energia com
  o horário.

**Baixa / V3:**

- Integrações Notion, Trello e ClickUp.
- Níveis por Pipo (ganha experiência por execução bem-sucedida e desbloqueia acessórios).
- Execução na nuvem para Pipos que precisam rodar com o PC desligado.

---

## 6. Dados (migração 002)

```
pipos(id, slug, name, color, accessory, mission, personality_json, model, effort,
      paused, run_on_days_off, active_version, metrics_json, created_at)
pipo_drafts(id, from_model_id, stage, transcript_session_id, draft_json, updated_at)
pipo_models(id, name, personality_json, playbook_json, created_at)      -- "Salvar como modelo" / .pipo importado
pipo_links(from_pipo_id, to_pipo_id, kind[after|handoff|ask], delay_min, enabled)
pipo_inbox(id, to_pipo_id, from_run_id, payload_path, status[pending|consumed|expired], created_at)
pipo_versions(id, pipo_id, version, playbook_json, changelog, created_at, approved_at)
pipo_triggers(id, pipo_id, kind[manual|schedule|event|after_pipo], spec_json, enabled, last_fired_at)
pipo_runs(id, pipo_id, version, trigger, status[queued|running|waiting|done|failed|cancelled],
          dry_run, started_at, finished_at, summary, metrics_json)
pipo_run_steps(id, run_id, step_key, status, started_at, finished_at, output_path, error)
pipo_memory(id, pipo_id, rule, source, created_at)
pipo_permissions(pipo_id, step_key, always_allow, limit_n)
day_status(date, kind[off|vacation|holiday|sick|half|offline_work|no_record], minutes, note, source)
holiday_prefs(region, worked_holidays_json)
```

- **Segredos:** em `secrets` (já existe), com a chave `pipo:<slug>:<NOME>`.
- **Servidores MCP externos por Pipo:** em `pipos/<slug>/mcp.json`, passado ao Claude Code só nos
  passos daquele Pipo.
- **Arquivos de cada Pipo:** `userData/pipos/<slug>/` com `scripts/`, `templates/` e
  `runs/<run_id>/`. Execuções com mais de 90 dias são apagadas (configurável).
- **Ausências no cálculo:** `insights/mood.ts`, `insights/streak.ts` e as médias passam a ignorar os
  dias com `day_status` de ausência.

---

## 7. Fases

### Fase 13 — Ajustes da V1: luz, botão de foco e dança

Vem primeiro porque são melhorias visíveis no app de hoje (seção 3.1).

- **Implementar:**
  - glow ancorado na borda de baixo do notch;
  - botão "▶ Focar: <tarefa>" no Início, ▶ na pill, item na bandeja, botão no topo de Tarefas,
    "Próxima ▶" no card de concluído e "foca na próxima" no chat/voz;
  - estado `dancing`, com detecção de música (Spotify API, janela do Spotify e arquivo local) e a
    opção em Configurações → Reações.
- **Aceite:** os aceites de cada item da seção 3.1, com capturas antes/depois.

### Fase 14 — Modelo configurável

- **Implementar:**
  - `--model`, `--effort` e `--fallback-model` no `ClaudeCodeProvider`;
  - seletor nas Configurações;
  - botão "Pensar mais";
  - modelo usado no rodapé da resposta;
  - padrão `sonnet` na migração das configurações.
- **Aceite:**
  - perfil novo → `system/init` reporta Sonnet;
  - trocar para Opus nas Configurações → a próxima resposta reporta Opus;
  - "Pensar mais" refaz a última resposta com opus/high;
  - testes do provider cobrem os args.

### Fase 15 — Dias não trabalhados

É independente e corrige o humor e a sequência da V1.

- **Implementar:**
  - tabela `day_status`;
  - feriados BR calculados localmente;
  - pergunta "ontem não te vi";
  - `/ferias`;
  - efeitos no humor, na sequência e nas interrupções;
  - mascote de pijama;
  - card "enquanto você estava fora" (versão simples, sem os Pipos ainda).
- **Aceite:**
  - simular 4 semanas com uma folga e um feriado → a sequência não quebra e as médias ignoram esses
    dias;
  - feriados de 2026 e 2027 batem com o calendário oficial;
  - um dia útil vazio gera exatamente uma pergunta.

### Fase 16 — Núcleo de Pipos

- **Implementar:**
  - migração 002 (tabelas de Pipos);
  - repositórios;
  - pasta por Pipo;
  - cofre de segredos por Pipo;
  - IPC tipado `pipos:*`;
  - aba Equipe vazia, com o convite "Crie seu primeiro Pipo com /criarpipo".
- **Aceite:**
  - o app abre sem nenhum Pipo colorido;
  - criar, editar, pausar e apagar um Pipo pela API interna funciona;
  - segredo salvo não aparece em nenhum log nem no banco em texto claro.

### Fase 17 — Executor de processos

- **Implementar:**
  - `src/main/pipos/runner.ts` com todos os tipos de passo genéricos: `script`, `http`, `mcp`, `sheet`,
    `agent`, `confirm`, `branch`, `notify` e `handoff`;
  - templating de saídas e entradas;
  - métricas declaradas;
  - timeouts;
  - cancelamento;
  - 1 execução por Pipo e no máximo 2 simultâneas;
  - modo seco;
  - máscara de segredos;
  - pausa após 3 falhas;
  - eventos de progresso para a UI.
  - Para o passo `sheet`: escopo `spreadsheets` adicionado ao OAuth Google existente.
- **Aceite:**
  - um processo de teste com `script` → `http` (servidor local de teste) → `agent` → `confirm` →
    `branch` → `notify` roda;
  - cancelar no meio mata o filho;
  - recusar o `confirm` encerra como "cancelled";
  - o passo `http` nunca mostra o segredo no log;
  - testes de unidade do executor passam.

### Fase 18 — `/criarpipo`

- **Comandos com `/` no chat:**
  - autocompletar;
  - `/criarpipo`, `/editarpipo`, `/equipe`, `/rodar` e `/pausar`.
- **Fluxo de criação em 7 etapas (seção 2.3):**
  - roteiro genérico de entrevista;
  - barra de progresso;
  - rascunho persistente;
  - mini-Pipo tracejado na pill;
  - chips de ideia.
- **Ferramentas MCP de construção:**
  - `draft_pipo`, `set_personality`, `add_step`, `edit_step`;
  - `test_step` (sempre seco);
  - `request_secret`: abre campo seguro no notch, o valor nunca passa pelo chat;
  - `import_script`: o usuário arrasta o script existente;
  - `add_mcp_server`;
  - `declare_metrics`;
  - `propose_plan` (card do plano) e `hire_pipo` (Y/N).
- **Modelos do próprio usuário:** "Salvar como modelo".
- **Aceite:**
  - partindo do zero, o usuário cria pelo chat um Pipo de teste (ex.: "todo dia às 18h, lê um JSON
    de uma pasta e me manda um resumo") → plano → ensaio seco → contratar: o Pipo entra na Equipe e se
    apresenta;
  - fechar o app no meio da criação e reabrir → retoma da mesma etapa;
  - `/editarpipo` gera a v2 com diff.

### Fase 19 — Gatilhos

- **Implementar:**
  - gatilho manual: botão, `@slug` ou `/rodar` no chat e atalho opcional;
  - agenda em linguagem natural ("seg–sex 9h", "a cada 2h das 8 às 18") convertida em cron local, com
    prévia das próximas 3 execuções;
  - recuperação: se o PC estava desligado, pergunta "rodar a das 9h que perdeu?";
  - respeito a folgas e férias, conforme `run_on_days_off`;
  - execuções agendadas não interrompem foco ou reunião (só o card final entra no orçamento de
    interrupções).
- **Aceite:**
  - uma agenda de 2 min dispara 2 vezes;
  - durante um foco, o card final vai para a fila;
  - `@<nome> roda` no chat dispara a execução;
  - num dia marcado como folga, um Pipo com `run_on_days_off=false` não roda.

### Fase 20 — Pipos coloridos (visual)

- **Implementar:**
  - paleta;
  - mini-Pipos na pill com os 5 estados, mais "rascunho";
  - tooltip;
  - animação de contratação;
  - aba Equipe com cartões;
  - tela de execução em linha do tempo;
  - chat por Pipo com a cor dele;
  - seletor de acessório.
- **Aceite:**
  - capturas de cada estado contra a referência;
  - 4 Pipos rodando juntos não pesam (CPU ociosa abaixo de 2%);
  - a transição de aceso para apagado é suave.

### Fase 21 — Conexão entre Pipos

- **Implementar (seção 2.5):**
  - tabelas `pipo_links` e `pipo_inbox`;
  - gatilho "depois de" com atraso;
  - passo `handoff` com pacote de dados;
  - consulta a outro Pipo dentro de um passo `agent` (profundidade 1);
  - recusa de ciclos;
  - pergunta "depende de outro Pipo?" no roteiro;
  - arrastar um Pipo sobre o outro na Equipe;
  - mapa de conexões;
  - luz correndo entre os mini-Pipos na pill.
- **Aceite:**
  - dois Pipos de teste: o A gera uma lista, entrega ao B, e o B roda 2 min depois com a lista como
    entrada;
  - se o A falhar, o B não roda;
  - tentar criar A → B → A é recusado com explicação;
  - captura da luz correndo entre os mini-Pipos.

### Fase 22 — Dashboards

- **Implementar:**
  - janela de dashboards com as visões Hoje, Semana/Mês, Ano, Ritmo, Clientes, Equipe e Métricas dos
    Pipos (seção 4.3);
  - funis automáticos a partir das métricas declaradas;
  - ausências marcadas nas visões;
  - exportação CSV/PDF;
  - "pergunte ao dashboard";
  - ferramentas MCP de consulta agregada;
  - relatório semanal;
  - gráficos com paleta própria validada para o tema escuro (contraste e daltonismo).
- **Aceite:**
  - com dados simulados de 4 semanas (incluindo folga, férias e trabalho no fim de semana), cada visão
    bate com o banco;
  - um Pipo de teste com métricas em etapas gera um funil sem código específico;
  - "em que horário eu rendo mais?" é respondido corretamente;
  - a janela abre em menos de 1s.

### Fase 23 — Extras

- **Implementar:**
  - gatilhos por evento (e-mail com marcador, arquivo numa pasta, fim de reunião, webhook local);
  - aprovação em lote;
  - memória por Pipo;
  - exportar/importar `.pipo`.
- **Aceite:**
  - um Pipo exportado e importado em outro perfil roda o ensaio seco depois de receber os segredos;
  - cada gatilho por evento dispara uma vez por evento.

### Fase 24 — Teste do Prospector, polimento e empacotamento V2

- **Teste de aceite da estrutura:** criar o Prospector **do zero pelo app**, como um usuário faria:
  - o script do usuário puxa os leads do Apify (passo `script`, ou `http` com o token no cofre);
  - o envio sai pelo Resend (`http` ou o MCP do serviço);
  - a planilha é atualizada (`sheet`);
  - um Follow-up conectado roda 3 dias depois (`handoff` + "depois de").
  - Usar uma lista com 3 e-mails próprios. Rodar de novo não pode reenviar.
  - **Se algo exigir código específico do Prospector, a estrutura está incompleta:** corrigir a
    estrutura, não o Pipo.
- **Implementar:**
  - migração de perfis da V1 sem perda;
  - README e `docs/pipos.md`;
  - workflow de build;
  - teste de fumaça com o app empacotado no Windows e no macOS.
- **Aceite:**
  - o Prospector funciona ponta a ponta sem nenhuma linha de código dele no app;
  - CI verde;
  - instaladores gerados;
  - atualizar da V1 mantém tarefas, histórico e configurações.

---

## 8. Fora do escopo da V2

- Pipos executando com o PC desligado: fica para a V3 (nuvem).
- Pipos pré-instalados: nenhum. O app traz só a estrutura, e os Pipos são do usuário.
- Ordens de compra/venda reais em qualquer Pipo: nunca.
- Bash livre para qualquer Pipo: nunca.
