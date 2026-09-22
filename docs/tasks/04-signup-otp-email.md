# 04. Signup OTP email

## Introdução

O cadastro já gera um código de 6 dígitos, mas ele não chega a lugar nenhum. Esta etapa liga essa ponta a um mecanismo real de envio.

O ponto mais importante do desenho é que a aplicação não fala com nenhum provedor de email. Ela fala com uma interface de uma função só, e a escolha do provedor acontece uma única vez, dentro do plugin que decora `fastify.emailSender`. Trocar de provedor depois vira escrever uma classe nova, sem tocar em regra de negócio.

Essa mesma interface resolve o desenvolvimento local e os testes. Nos testes as mensagens ficam em memória para as asserções, em desenvolvimento elas caem num servidor SMTP local com interface web, e em produção vão pela API do provedor.

## Requisitos técnicos

### A interface

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

* Sempre HTML e texto puro juntos, porque parte dos clientes de email não renderiza HTML e uma mensagem só com HTML também pontua pior em filtros de spam
* O retorno traz o identificador da mensagem no provedor, que é o que permite rastrear uma entrega específica nos logs depois
* Falhas de provedor sobem como um erro tipado próprio, `EmailProviderError`, carregando status e corpo da resposta, de modo que quem chama consiga logar o diagnóstico sem inspecionar detalhes de HTTP
* Tudo isso vive em `src/plugins/app/email/`, seguindo o `fastify/demo`, onde utilitário transversal escrito pelo projeto é um plugin em `plugins/app`. O `index.ts` é o plugin: chama `createEmailSender(config)` e decora `fastify.emailSender`, ou usa o remetente que veio por `AppOptions` quando um teste passa um. Os irmãos são a implementação: `sender.ts` com a interface e o erro, `create-sender.ts` com a escolha do driver, e `drivers/` com `fake.ts`, `mailpit.ts` e `resend.ts`. Como a pasta tem `index.ts`, o autoload carrega só ele e os irmãos não viram plugin

### O template

* Função pura que recebe o código e o prazo de validade e devolve assunto, HTML e texto. Os drivers apenas transportam a mensagem e não sabem o que é um código de confirmação
* O template fica em `src/plugins/app/auth/emails/signup-code.ts`, dentro do domínio que o usa, e não em `plugins/app/email/`. Ele é conhecimento do fluxo de cadastro, e o plugin de email só conhece transporte. A subpasta `emails/` existe para que o próximo template do domínio tenha onde nascer
* Assunto traz o código, porque muita gente lê e digita direto da lista de mensagens sem abrir o email
* Corpo com o código em destaque, o prazo de validade e a frase avisando que quem não pediu pode ignorar, que é o que permite a pessoa perceber uso indevido do seu email
* HTML de uma coluna, com CSS inline, sem imagens e sem links. Cliente de email ignora folha de estilo externa, e mensagem de autenticação sem link é imune a virar treino de phishing
* O código é o único valor dinâmico e é sempre gerado como dígitos, então nenhum dado vindo de usuário entra no template e não há o que escapar

### Os três drivers

| Driver | Uso | Como funciona |
| --- | --- | --- |
| `fake` | ambiente de teste | Guarda as mensagens numa lista em memória e devolve identificadores sequenciais, permitindo assertar destinatário e conteúdo. É o driver que `EMAIL_DRIVER=fake` seleciona; os testes de rota costumam ir além e passar um remetente falso direto por `AppOptions` |
| `mailpit` | desenvolvimento | Envia por SMTP para o Mailpit em `localhost:1025`, com as mensagens visíveis em `http://localhost:8025` |
| `resend` | produção | `POST` na API do provedor usando o `fetch` nativo, sem SDK |

* O Mailpit sobe junto do Postgres no Docker Compose, então um `docker compose up -d` deixa o ambiente inteiro pronto
* O endereço do Mailpit fica fixo no código em vez de virar variável de ambiente, porque é sempre o mesmo endereço local e uma variável a mais ali só cria oportunidade de configurar errado

### Configuração

| Variável | Regra |
| --- | --- |
| `EMAIL_DRIVER` | Sempre exigida, sem valor padrão, aceitando `fake`, `mailpit` ou `resend` |
| `EMAIL_FROM` | Exigida, exceto quando o driver é `fake` |
| `RESEND_API_KEY` | Exigida apenas quando o driver é `resend` |

* Não ter valor padrão para o driver é proposital. Um padrão faria o ambiente errado funcionar silenciosamente, e o modo de falha seria descobrir em produção que nenhum email foi enviado
* A chave do provedor nunca vai para o repositório, e vale criar no painel uma chave com permissão apenas de envio
* Enquanto não houver domínio próprio verificado, o remetente de teste do provedor só entrega para o email da própria conta e recusa qualquer outro destinatário. Verificar um domínio (com SPF, DKIM e DMARC num subdomínio dedicado) muda apenas o valor de duas variáveis, sem tocar no código

### Resiliência no adapter de produção

* Timeout de 10 segundos por requisição, via `AbortSignal.timeout`
* Duas tentativas no total, e apenas para erro de rede, timeout, 429 e 5xx. Resposta 4xx nunca repete, porque requisição malformada ou chave inválida não melhora tentando de novo
* As duas tentativas usam a mesma `Idempotency-Key`, gerada uma vez por chamada, de modo que um timeout que na verdade chegou ao provedor não vire dois emails para a pessoa
* O corpo da requisição contém o código e por isso nunca aparece em log nem em mensagem de erro. O log de sucesso registra o identificador da mensagem associado ao identificador do cadastro pendente, sem email e sem código

### Falha de envio no fluxo de cadastro

* A ordem continua sendo gravar primeiro e enviar depois
* Quando o envio falha, o service captura o erro, registra o diagnóstico e o endpoint responde `503` com mensagem genérica, sem setar cookie e sem expor detalhe interno
* Uma falha de envio não pode consumir a cota de reenvio nem iniciar o cooldown de quem nem recebeu o email. Para isso o contador de envios volta para zero, o que estabelece o significado: contador zerado quer dizer que nenhum email foi entregue para o código atual, e o reenvio deve tratar esse caso como livre de cooldown

## Definition of done

* Interface definida e o fluxo de cadastro dependendo apenas dela, sem conhecer provedor
* Os três drivers funcionando e selecionados pela variável de ambiente
* Mailpit no Docker Compose, com instrução de uso no README
* Testes do cadastro usando o driver fake e verificando destinatário e presença do código na mensagem
* Testes do adapter de produção cobrindo sucesso, 4xx sem repetir, 5xx repetindo, 429 até esgotar as tentativas, erro de rede, e a mesma chave de idempotência entre as duas tentativas
* Teste da fábrica de drivers garantindo que cada valor da variável devolve a implementação correta
* `.env.sample` atualizado e nenhuma chave real versionada
* README explicando como rodar em cada um dos três modos
