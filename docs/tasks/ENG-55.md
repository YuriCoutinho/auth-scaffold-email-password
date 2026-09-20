# ENG-55 — Integração de envio de email no cadastro (OTP)

## Introdução

O endpoint de cadastro (ENG-56) já cria o registro pendente e gera o código de 6 dígitos, mas o código não chegava a lugar nenhum. Esta task conectou esse ponto a um mecanismo real de envio.

O envio fica atrás de uma interface própria, com três implementações trocadas por variável de ambiente: fake nos testes, Mailpit no desenvolvimento local e Resend em produção. A escolha do provedor fica isolada e pode mudar depois sem tocar no domínio da aplicação.

Nesta entrega o envio em produção funciona apenas para o email da conta do Resend, porque ainda não há domínio próprio verificado: usando o domínio de teste (`onboarding@resend.dev`), o provedor recusa com 403 qualquer outro destinatário. Registrar e verificar o domínio (SPF/DKIM/DMARC, subdomínio dedicado) é task separada; o código não muda quando ela acontecer, só o valor de duas variáveis de ambiente.

Entregue como PR **stacked** sobre a branch da ENG-56.

## Como foi implementado

**Interface** (`src/services/email-sender.ts`)

```ts
interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

interface EmailSender {
  send(message: EmailMessage): Promise<{ providerMessageId: string }>;
}
```

Sempre HTML e texto puro juntos. O service de signup fala só com essa interface (substituiu o stub no-op da ENG-56, que era um type alias de função). Erros de provedor são propagados como `EmailProviderError` (tipado, com `status` e `body` da resposta).

**Template** (`src/services/signup-email.ts`)

Função pura `renderSignupCodeEmail({ code, ttlMinutes })` — os drivers só transportam `EmailMessage`, agnósticos de OTP. Copy em inglês; assunto `Your verification code: <código>`; corpo com o código, o prazo de 15 minutos e a frase de "se não foi você, ignore este email"; HTML de uma coluna com CSS inline, sem imagens nem links; versão texto equivalente. Nenhum dado vindo do usuário entra no template (o código é sempre gerado como dígitos), então não há o que escapar.

**Implementações** (`src/services/email/`)

* `FakeEmailSender` — guarda as mensagens em memória (`sent`) e devolve ids sequenciais, para os testes assertarem
* `MailpitEmailSender` — nodemailer apontando para `localhost:1025` (hardcoded, sem envs de SMTP); Mailpit sobe via Docker Compose (`axllent/mailpit:v1`, portas 1025/8025), interface web em `localhost:8025`
* `ResendEmailSender` — `POST https://api.resend.com/emails` via `fetch` nativo, com `Authorization: Bearer ${apiKey}`; sem SDK, sem nodemailer

A escolha é feita uma vez, na composição das dependências (`createEmailSender(env)` em `src/services/email/create-email-sender.ts`, chamado no `server.ts`).

**Variáveis de ambiente** (validadas no boot em `src/config/env.ts`, documentadas no `.env.sample`)

| Variável | Regra | Exemplo |
| -- | -- | -- |
| `EMAIL_DRIVER` | sempre exigida, sem default (`fake\|mailpit\|resend`) | `mailpit` |
| `EMAIL_FROM` | exigida exceto quando o driver é `fake` | `Auth Scaffold <onboarding@resend.dev>` |
| `RESEND_API_KEY` | exigida só quando o driver é `resend` | `re_...` |

A chave nunca vai para o repositório; criar no painel do Resend uma chave com permissão apenas de envio.

**Adapter Resend**

* Timeout de 10s (`AbortSignal.timeout`)
* Retry apenas em erro de rede/timeout, 429 e 5xx — **duas tentativas no total** (uma original + um retry), com a mesma `Idempotency-Key` (um `crypto.randomUUID()` por chamada de `send`; o Resend deduplica por até 24h). 4xx nunca repete
* Falha final propaga `EmailProviderError` com status e corpo da resposta; o payload da requisição (que contém o código) nunca aparece em erro ou log
* Sucesso logado com `providerMessageId` associado ao `pendingSignupId` (o upsert do pendente passou a retornar o id) — nunca com o email do destinatário nem o código

**Integração com o fluxo** (`src/services/signup.ts`)

* Ordem: gravar primeiro, enviar depois (herdada da ENG-56, coberta por teste)
* Falha no envio: o service captura, loga o erro (status/corpo quando tipado) e retorna outcome `email-unavailable`; a rota responde **503** com mensagem genérica (`We could not send the confirmation email right now. Please try again shortly.`), sem setar cookie e sem vazar internals
* Para a falha não consumir cota de reenvio nem iniciar cooldown, um update best-effort zera `code_send_count` (novo método `resetPendingSignupSendState` no repo); `last_sent_at` é NOT NULL e fica intocado — a semântica é `code_send_count = 0` ⇒ nenhum email foi entregue para o código atual, e o futuro `/resend-code` deve tratar como livre de cooldown/cota
* Janela conhecida até existir o `/resend-code`: após um 503, novo POST /signup cai no caminho idempotente (202 sem reenvio); a recuperação é o resend futuro ou a expiração do TTL de 15 min

## Definição de pronto

* Interface `EmailSender` definida, com o fluxo de cadastro dependendo só dela ✔
* Três implementações funcionando, selecionadas por `EMAIL_DRIVER` ✔
* Mailpit no Docker Compose, com instruções no README ✔
* Testes do fluxo de cadastro usando o fake, verificando destinatário e presença do código ✔
* Teste do adapter Resend cobrindo sucesso, 4xx sem retry, 5xx com retry e mesma `Idempotency-Key` entre tentativas (mais 429 até esgotar e erro de rede) ✔
* `.env.sample` atualizado; nenhuma chave real versionada ✔
* README explicando como rodar em cada modo ✔
* Verificação manual pós-PR: email visualizado no Mailpit (HTML e texto, tela estreita), envio real em produção para o email da conta do Resend, comportamento com `bounced@resend.dev` e `delivered@resend.dev`

Fora do escopo: registro e verificação de domínio, SPF/DKIM/DMARC, webhooks de bounce, lista de supressão, rate limit por IP e CAPTCHA — tudo isso entra depois que houver domínio próprio.
