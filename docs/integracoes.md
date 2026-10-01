# Integrações

O Pipo conversa com três serviços. Tudo roda na sua máquina; tokens ficam criptografados com o
`safeStorage` do sistema (Keychain no macOS, DPAPI no Windows).

## Claude (obrigatório para chat/IA)

O Pipo usa o **Claude Code instalado e logado com a sua assinatura**. Não usa chave de API.

1. Instale o Claude Code: https://code.claude.com/docs/en/setup
2. Abra o terminal, rode `claude` e faça login com a sua conta.
3. No onboarding (ou Configurações → Integrações → Claude) clique em **Testar de novo**.

O Pipo chama `claude -p` com:
- prompt de sistema próprio (`--system-prompt-file`), resposta em streaming (`stream-json`);
- só as ferramentas do Pipo (servidor MCP `pipo`, via `--mcp-config` + `--strict-mcp-config`) e
  `Read` restrito à pasta de anexos (`userData/files/`); Bash, Edit, Write e WebFetch bloqueados;
- diretório de trabalho isolado (`userData/agent-workspace/`).

> Avançado: em Configurações → Integrações → Claude dá para usar uma chave de API
> (`claude-opus-5-5`, cobrada à parte). Fica desligado por padrão.

## Google Agenda + Gmail

Como o Pipo é um app desktop sem servidor, cada pessoa usa o próprio app OAuth do Google:

1. Acesse https://console.cloud.google.com/ e crie (ou escolha) um projeto.
2. **APIs e serviços → Biblioteca**: ative **Google Calendar API** e **Gmail API**.
3. **Tela de consentimento OAuth**: tipo *Externo*, adicione seu e-mail como usuário de teste e os
   escopos `calendar.events`, `calendar.readonly` e `gmail.readonly`.
4. **Credenciais → Criar credenciais → ID do cliente OAuth → App para computador**.
5. Copie o **Client ID** e o **Client Secret** e cole no Pipo
   (onboarding, etapa Google → "Credenciais do app Google", ou Configurações → Integrações).
6. Clique em **Conectar Google**. O navegador abre, você autoriza e volta pro Pipo.

O redirecionamento usa loopback (`http://127.0.0.1:<porta>/callback`), que o Google aceita para
apps de computador sem configuração extra. Para embutir as credenciais no build, defina
`MAIN_VITE_GOOGLE_CLIENT_ID` e `MAIN_VITE_GOOGLE_CLIENT_SECRET` num arquivo `.env`.

O que o Pipo faz:
- lê os eventos de hoje e dos próximos 7 dias (a cada 5 min) e avisa 5 min antes de cada
  reunião com o botão **Entrar** (abre o link do Meet/Zoom/Teams);
- cria blocos de foco quando você aceita o plano do dia;
- lê e-mails não lidos (somente leitura) quando você pede ou na reação "e-mail longo".

## Spotify (opcional)

1. Em https://developer.spotify.com/dashboard crie um app (Web API).
2. Em **Redirect URIs** adicione exatamente: `http://127.0.0.1:43821/callback`
3. Copie o **Client ID** e cole em Configurações → Integrações → Spotify (ou `MAIN_VITE_SPOTIFY_CLIENT_ID`).
4. Clique em **Conectar**.

O Spotify Web API exige **Premium** e um dispositivo ativo (o app aberto em algum lugar). Sem isso,
o Pipo cai no plano B: abre a playlist direto no app do Spotify (`spotify:playlist:...`).
Sem conectar nada, você também pode colar o link de uma playlist (Spotify/YouTube) ou escolher um
arquivo de áudio local no ritual de música.

## Stripe (opcional): dinheiro entrando

1. Na Stripe, vá em **Developers → API keys → Create restricted key**.
2. Dê permissão **Read** só em **Balance transactions** e crie a chave (`rk_live_…` ou `rk_test_…`).
3. Cole em Configurações → Integrações → Stripe. A chave vai para o cofre do sistema
   (`safeStorage`) e aparece só como `••••1234`.

O Pipo só lê: soma cobranças menos reembolsos de hoje, da semana ou do mês e mostra o valor na pill
(pisca quando entra dinheiro novo). Dá para esconder os valores ou tirar da pill. Os dashboards
mostram a entrada por dia. O Pipo nunca cobra, reembolsa nem altera nada na Stripe.

## Voz

A transcrição usa o Whisper (`onnx-community/whisper-base`) rodando localmente via
transformers.js. Na primeira vez o modelo (~80 MB) é baixado do Hugging Face e fica em cache;
depois funciona offline. O áudio nunca sai do computador.
