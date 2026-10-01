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
| `mcp` | Ferramenta de um servidor MCP declarado no `mcp.json` do Pipo. |
| `sheet` | Ler, adicionar ou atualizar linhas no Google Sheets (conexão das Configurações). |
| `agent` | Julgamento: escrever, classificar, resumir. Pode pedir JSON e consultar outro Pipo. |
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
- `{{segredo.NOME}}`: só em `script`, `http` e `mcp`. O valor nunca aparece em logs nem no histórico
  (mostrado como `••••`).
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
