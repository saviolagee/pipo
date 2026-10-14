# Pipos coloridos

Um Pipo colorido é um ajudante que **você cria conversando** com o Pipo original. Cada um tem
personalidade (missão, tom, o que nunca fazer), uma cor, um acessório e um **plano de execução fixo e
versionado**, que ele repete quando você pede, num horário ou quando algo acontece.

O app não traz nenhum Pipo pronto. Ele traz só a estrutura, e a equipe é sua.

## Criar: `/criarpipo`

No chat, digite `/criarpipo` e descreva o trabalho:

> /criarpipo Quero um Pipo que puxa leads do Apify, manda um e-mail de apresentação pelo Resend,
> atualiza minha planilha e me avisa quantos foram.

O Pipo conduz a conversa em etapas, mostradas na barra do rascunho:

1. **Entrevista:** o que ele faz, com que frequência, de onde vêm os dados, o que nunca pode fazer.
2. **Conexões:** chaves de API são pedidas num **campo seguro** no notch e vão direto para o cofre
   daquele Pipo. Nunca cole uma chave no chat. Se você já tem um script, arraste o arquivo no chat;
   se não tem, ele escreve um.
3. **Plano:** ele monta os passos e mostra o plano num card, com avisos de validação.
4. **Ensaio:** roda tudo em modo seco. Leituras acontecem, mas nada sai da máquina: e-mails não são
   enviados e a planilha não é alterada.
5. **Contratar:** o Pipo entra na equipe com o plano v1.

Para mudar depois, abra o Pipo na aba **Equipe** e clique em **Editar plano**. Cada mudança aprovada
vira uma nova versão, com a diferença entre elas.

## O plano de execução

Cada passo tem uma `key` (usada nos templates) e um `title`. Tipos:

| Tipo | Para quê |
|---|---|
| `script` | Roda um arquivo de `scripts/` do Pipo (node, python, powershell, pwsh, bash, sh). Recebe os segredos como variáveis de ambiente, a entrada em `PIPO_INPUT` e `PIPO_DRY_RUN=1` no ensaio. Imprime JSON. |
| `http` | Chamada de API (GET/POST/…). Resposta JSON vira a saída. |
| `browser` | Abre uma página num navegador de verdade e faz as ações em ordem (clicar, preencher, ler). Veja [Navegador](#navegador). |
| `mcp` | Ferramenta de um servidor MCP declarado no `mcp.json` do Pipo. |
| `sheet` | Ler, adicionar ou atualizar linhas no Google Sheets (conexão das Configurações). |
| `agent` | Julgamento: escrever, classificar, resumir. Pode pedir JSON e consultar outro Pipo. |
| `decide` | Escolhe **uma** entre opções fixas (classificar, rotear, sim/não, qual link abrir). Veja [Decisões](#decisões). |
| `confirm` | Pede sua confirmação no notch. Com `list`, vira **aprovação em lote**: um carrossel para revisar, editar e pular itens. |
| `branch` | Condição simples (`{{x}} > 0`): encerra ou pula para outro passo. |
| `notify` | Aviso no notch. Execuções agendadas esperam o foco acabar. |
| `handoff` | Entrega um pacote para outro Pipo (vira a `{{entrada}}` dele). |

### Templates

- `{{passos.<key>.saida}}`: saída de um passo anterior (`.campo`, `[0]`, `.length`).
- `{{entrada}}`: o que outro Pipo entregou. Quando o Pipo roda "depois de" outro,
  `{{entrada.saidas.<passo>}}` traz a saída de cada passo do anterior, além de `{{entrada.resumo}}` e
  `{{entrada.metricas}}`.
- `{{pipo.nome}}`, `{{agora.data}}`, `{{agora.hora}}`, `{{execucao.seco}}`.
- `{{segredo.NOME}}`: só em `script`, `http`, `browser` e `mcp`. O valor nunca aparece em logs nem no
  histórico (mostrado como `••••`).
- Filtros: `| length`, `| json`, `| first`, `| last`, `| join:, `, `| default:x`, `| upper`, `| lower`,
  `| number`, `| novos:<passo>`.

### Envio por item, sem repetir

Um passo `http` com `each` faz uma requisição por item da lista, com `{{item}}` e `{{indice}}`
disponíveis na URL e no corpo. Com `onceBy`, o Pipo guarda quem já recebeu e **nunca repete**, mesmo
se a execução cair no meio:

```json
{
  "kind": "http", "key": "enviar", "title": "Enviar e-mails", "method": "POST",
  "url": "https://api.resend.com/emails",
  "headers": { "Authorization": "Bearer {{segredo.RESEND_API_KEY}}" },
  "body": "{\"from\": \"oi@minhaagencia.com\", \"to\": \"{{item.email}}\", \"subject\": \"{{item.assunto}}\", \"html\": \"{{item.texto}}\"}",
  "each": "{{passos.escrever.saida}}",
  "onceBy": "{{item.email}}"
}
```

A saída é `{enviados, pulados, falhas, resultados}`. O filtro `| novos:enviar` tira de uma lista quem
o passo `enviar` já atendeu. Use-o para a confirmação mostrar só os novos e para encerrar cedo:
`{{passos.leads.saida | novos:enviar | length}} == 0` → `end`.

### Navegador

Para sites sem API. O passo `browser` usa o Chromium embutido no app, numa janela fora da tela, com a
**sessão do próprio Pipo** (cookies e logins separados dos outros Pipos e do seu navegador):

```json
{
  "kind": "browser", "key": "precos", "title": "Ler os preços", "url": "https://loja.com/",
  "actions": [
    { "do": "fill", "target": "Buscar", "value": "{{entrada.termo}}" },
    { "do": "submit", "target": "Buscar" },
    { "do": "wait", "for": ".resultado" },
    { "do": "list", "as": "nomes", "target": ".resultado h2" },
    { "do": "list", "as": "links", "target": ".resultado a", "attr": "href" },
    { "do": "screenshot", "as": "retrato" }
  ]
}
```

- Ações: `goto`, `click`, `fill`, `submit` (envia o formulário, como Enter), `press`, `wait`
  (`seconds` ou `for`), `read`, `list` e `screenshot`. `target` é um seletor CSS ou o texto visível do
  botão, link ou campo (`css=…` e `texto=…` tiram a dúvida).
- A saída é um objeto com cada `as`, mais `url` e `titulo`. O retrato vai para a pasta da execução e
  aparece na galeria do painel.
- Passo que preenche, envia ou aperta tecla conta como externo: pede confirmação e, no ensaio, só é
  descrito (nada é enviado). Passo que só lê roda de verdade no ensaio.
- **Login:** o botão **Navegador** no detalhe do Pipo abre a janela do navegador dele. Você entra no
  site com a sua senha uma vez e a sessão fica guardada. O Pipo não digita senha de login, e se
  aparecer captcha é você quem resolve nessa janela.
- Downloads, câmera, microfone, localização e avisos do site ficam bloqueados.
- Use `http` quando o site tem API: é mais rápido e quebra menos. Respeite os termos de uso de cada
  site.

### Site vira API

Muitos sites carregam os dados por chamadas internas (as mesmas que a página faz por baixo). Na
criação do Pipo, o construtor pode **gravar** essas chamadas (`capture_site_api`): abre o site na
janela do navegador do Pipo, você entra e faz uma vez o que ele deve repetir, clica em **Terminei**, e
o construtor monta passos `http` com o que viu. Daí em diante o Pipo roda **sem abrir navegador**.

- Cookies e tokens da sessão vão direto para o cofre do Pipo (`SITE_<SITE>_COOKIE`, `…_AUTH`…). O
  modelo só vê o nome deles, nunca o valor.
- O passo guarda de onde veio (`capturedFrom`). A cada execução o cookie é renovado a partir da
  sessão do navegador do Pipo.
- **Sessão vencida:** o passo falha com "A sessão do site expirou". Abra o Pipo, clique em
  **Navegador**, entre no site de novo e feche a janela: os cookies e tokens que o plano usa são
  trocados pelos novos e o plano não muda.
- **O site mudou** (a chamada não existe mais ou devolve outra coisa): edite o Pipo (`/editarpipo`)
  e peça para refazer a captura.
- Chamadas de login não entram, e todo campo com nome de senha, token, cartão ou documento vira
  segredo (no pedido) ou `••••` (no exemplo de resposta) antes de chegar ao modelo.
- Só são gravadas chamadas de dados (XHR/fetch); páginas, imagens e rastreadores ficam de fora.
  Automatize só o que os termos de uso do site permitem.

### Decisões

```json
{
  "kind": "decide", "key": "triagem", "title": "Classificar o e-mail", "activity": "triagem_email",
  "state": "{{passos.ler.saida}}", "question": "Que tipo de e-mail é este?",
  "options": { "orcamento": "pede preço ou proposta", "suporte": "relata um problema", "outro": "qualquer outra coisa" }
}
```

A saída é `{escolha, confianca, origem}`. `options` também pode ser um template que vira uma lista
(por exemplo os títulos lidos por um passo `browser`), e a escolha pode ser o `target` de um `click`.

- **Quem decide no começo é o Claude** (modelo rápido). O conteúdo a decidir vai como dado: pedidos
  escritos nele são ignorados.
- **Cada decisão vira um exemplo da atividade** (`activity`). Decisões do mesmo tipo usam o mesmo
  nome; tipos diferentes nunca dividem o nome.
- **Modelo local do Pipo, um por atividade.** Em Configurações → Agente (IA) → Decisões dos Pipos,
  "Treinar modelo do Pipo" treina um classificador só para aquela atividade, dentro do app: na
  CPU, sem Python e sem placa de vídeo. Um modelo de leitura de texto multilíngue
  ([multilingual-e5-small](https://huggingface.co/Xenova/multilingual-e5-small), MIT, 118 MB,
  baixado uma vez) transforma cada exemplo num vetor, e uma camada de decisão pequena é treinada
  em cima deles.
  - **Só liga se passar na prova:** pelo menos 24 exemplos com gabarito, e 92% de acerto em
    exemplos que ficaram fora do treino, nas decisões que ele responde sozinho.
  - **Na dúvida, devolve para o Claude** (confiança abaixo do limite escolhido na prova). Essa
    decisão vira mais um exemplo, e a cada 5 exemplos novos o modelo treina de novo sozinho. Se o
    acerto cair, ele pausa.
  - Nunca é usado cru nem emprestado de outra atividade. Atividade cujas opções mudam a cada
    decisão (uma lista de links) não dá para treinar e fica com o Claude.
  - Dá para **importar exemplos** já com a resposta certa (um JSON por linha) para começar com o
    modelo treinado, e exportar os exemplos de qualquer atividade.
  - No teste de desenvolvimento, com 48 e-mails de exemplo: treinou em 11 s, acertou 8 de 8
    e-mails novos, respondeu 6 sozinho em menos de 0,2 s cada e mandou 2 para o Claude.
- **Laya (opcional):** quem já tem o [Laya](https://nandhakishorm.github.io/laya/finetune/)
  treinado para uma atividade pode ligar o `laya-serve` dela ("Usar Laya"), com a mesma regra:
  só para aquela atividade e só depois de acertar 90% dos exemplos dela. O servidor tem de estar
  na própria máquina. O app não instala nem treina o Laya: isso pede Python, o pacote `laya` e
  placa de vídeo (a documentação dele fala em 16 GB), e não foi rodado no desenvolvimento do Pipo.

### Servidores MCP conhecidos

O construtor adiciona com `add_known_server` (você confirma antes: é nessa hora que o pacote é
baixado) e vê as ferramentas com `list_mcp_tools`.

| Servidor | Para quê | Precisa de |
|---|---|---|
| `rea` | [REA](https://github.com/morluto/rea) (MIT): engenharia reversa com agentes. Analisa apps, sites, APKs, firmware e binários sem o código-fonte. Roda `npx -y rea-agents@6.4.0 mcp`. | Node.js 22.19+ (ou 24.11+). Para binários nativos, Ghidra, Hopper ou IDA; para APKs, JADX com um JDK; para sites, um navegador da família Chrome. |

O **Pipo branco** também navega, pelo chat: pesquisa (`web_search`), abre e lê páginas (`web_open`,
`web_read`) e age em sites (`web_click`, `web_fill`). Ler não pede confirmação. Clicar num botão,
preencher um campo ou abrir um endereço que você não citou (e que não veio de uma busca ou de uma
página já aberta) pede. Ele nunca digita senha: para login, abre a janela do navegador para você
(`web_show`). O que está escrito numa página é tratado como dado, não como ordem.

### Limites e segurança

- Scripts só rodam de `scripts/` do Pipo e só com os interpretadores permitidos. Nenhum Pipo tem
  terminal livre.
- Passos com efeito fora da máquina (`external`) pedem confirmação, a menos que você tenha escolhido
  "Sempre permitir".
- Cada execução tem tempo máximo, e "Cancelar" mata o processo do script.
- No máximo 2 execuções ao mesmo tempo, e 1 por Pipo.
- Depois de 3 falhas seguidas, o Pipo pausa e avisa.

## Quando ele roda

- **Na hora:** botão **Rodar** na Equipe, "@slug roda" no chat, ou pedindo no chat dele.
- **Horário em linguagem natural:** "dias úteis às 9h", "toda segunda às 8h30". Se o PC estava
  desligado, ele pergunta se deve rodar o que perdeu. Em folgas e férias, só roda se você permitir.
- **Eventos:** arquivo novo numa pasta, e-mail com um marcador do Gmail, fim de reunião, ou um webhook
  local (`http://127.0.0.1:43822/pipo/<token>`, só acessível desta máquina).
- **Depois de outro Pipo:** arraste um Pipo sobre outro na Equipe para conectar ("depois de", com
  atraso opcional, como "3 dias depois"). Ciclos (A → B → A) são recusados.

## Conversar com um Pipo

Clique em **Conversar** no Pipo. Ele responde com a personalidade dele, consulta o próprio plano e as
execuções, roda o plano quando você pede e **aprende regras** ("nunca mande e-mail no fim de semana").
As regras aparecem no detalhe do Pipo, onde dá para editar, apagar ou adicionar à mão.

## Painel de cada Pipo

Cada Pipo tem um painel próprio na janela de dashboards, montado com o que **ele** faz. Abra pelo
botão **Painel** no detalhe do Pipo, ou em Dashboards → Equipe → **Abrir painel**.

- **Resultados:** as métricas do plano em números grandes, comparadas com o período anterior. A
  métrica marcada com `"main": true` no plano é o número em destaque (um Pipo de vídeo mostra
  "vídeos feitos"). Sem `main`, vale o fim do funil ou a primeira métrica.
- **Agora e custo:** próxima execução, pendências (confirmações esperando você e entregas na fila),
  tempo economizado e tokens gastos no período, por execução e no mês. Os tokens são os dos passos
  `agent`, ensaios incluídos.
- **Por dia, funil e comparação:** a métrica em destaque por dia, o funil (métricas com `stage`) e o
  período atual contra o anterior. Com o período em andamento, a comparação usa o mesmo trecho do
  anterior (até quarta contra até quarta).
- **Falhas e motivos:** quantas execuções falharam, em que passo e por quê. O mesmo motivo é agrupado.
- **O que ele produziu:** arquivos e links que os passos devolveram. Para aparecerem, o passo precisa
  devolver no JSON o caminho completo do arquivo ou a URL; o que o script grava em `PIPO_RUN_DIR`
  também entra. Um clique abre vídeo, imagem, áudio e documento; outros tipos são mostrados na pasta.
- **Execuções:** quando rodou, quanto demorou e o que saiu. Um clique mostra a execução no notch.

Em **Personalizar** você escolhe o número em destaque, a ordem dos cartões e o que fica oculto. A
escolha fica guardada por Pipo nesta máquina (não vai junto no `.pipo`).

## Compartilhar

- **Salvar como modelo:** guarda o Pipo para criar outros parecidos (`/criarpipo` → "a partir de um
  modelo").
- **Exportar .pipo:** arquivo JSON legível com personalidade, plano, gatilho e scripts. Leva só os
  **nomes** dos segredos, nunca os valores. Quem importa recebe os campos seguros para preencher.

## Exemplo: Prospector + Follow-up

Exemplo de equipe montada pelo `/criarpipo`. Nenhuma linha dele existe no app:

**Prospector** (dias úteis às 9h)

1. `http` GET no dataset do Apify (`{{segredo.APIFY_TOKEN}}`).
2. `script` que tira quem já está na planilha.
3. `branch`: ninguém novo → encerra.
4. `agent` que escreve um e-mail curto por lead (JSON).
5. `confirm` com `list`: você revisa, edita e pula e-mails no carrossel.
6. `http` POST no Resend com `each` e `onceBy: {{item.email}}`.
7. `sheet` (ou script) que atualiza a planilha.
8. `notify` "N e-mails enviados".

**Follow-up** (3 dias depois do Prospector)

Recebe `{{entrada.saidas.enviar}}`, escreve o segundo e-mail, pede confirmação em lote e envia com
`onceBy`, para que ninguém receba dois follow-ups.
