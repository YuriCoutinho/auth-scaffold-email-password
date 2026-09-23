# 05. Resend code endpoint

## Introdução

Código de confirmação se perde. Cai em spam, chega atrasado, some junto com a aba fechada. Sem um caminho de reenvio, a única saída é esperar o cadastro expirar, e é aí que a pessoa desiste.

Por outro lado, este é o endpoint que mais chama o provedor de email, e provedor de email se paga por mensagem. Ele é o ponto natural para alguém transformar seu produto numa máquina de enviar email para terceiros. Por isso o controle de custo e abuso vive aqui, em camadas, e sempre antes de gastar a chamada.

Este é também o único caminho de reenvio do sistema, já que o cadastro é idempotente e nunca reenvia nada.

## Requisitos técnicos

### Contrato

* `POST /auth/resend-code`, sem body nenhum
* O cadastro pendente é identificado exclusivamente pelo token no cookie `signup_session`. Não aceitar email como parâmetro é o que impede alguém de varrer endereços de terceiros disparando emails em nome do seu produto
* Sucesso responde `202` com mensagem condicional, no mesmo espírito genérico do cadastro, e renova o cookie com o mesmo token para acompanhar a nova expiração
* Cookie ausente, token desconhecido e cadastro expirado respondem o mesmo `401`, sem diferenciar os três casos
* Documentado no OpenAPI com os três status possíveis

### Controles de custo, checados antes de gravar e de chamar o provedor

A ordem importa, e é teto primeiro, cooldown depois.

1. **Teto por cadastro**: no máximo 5 envios no total, contando o disparado pelo próprio cadastro. Atingido o teto, responde `429` explicando que só resta esperar o cadastro expirar e começar de novo
2. **Cooldown por cadastro**: 60 segundos desde o último envio, respondendo `429` pedindo para aguardar, sem tocar o banco além da leitura e sem chamar o provedor

O contador regressivo desabilitando o botão no front é usabilidade e não segurança. A barreira real precisa estar no servidor, porque o front é só uma sugestão para quem tem um cliente HTTP.

Existe uma exceção ao cooldown que vem da etapa anterior: quando o contador de envios está zerado, nenhum email foi entregue para o código atual, então não faz sentido cobrar espera de quem não recebeu nada.

### Reemissão

* Gera código novo, substitui o hash, zera o contador de tentativas e renova a expiração por mais 15 minutos, o mesmo tempo de vida do cadastro
* Zerar as tentativas é o que tira do limbo um cadastro cujo código foi invalidado por erros seguidos, e por isso o reenvio é a saída natural daquele estado
* Reaproveita a interface de envio e o template da etapa anterior, sem falar com o provedor diretamente

### Falha de envio sem nada a compensar

* O estado novo e a mensagem que o anuncia são gravados na mesma transação, então não existe janela entre gravar e enviar em que algo precise ser desfeito
* O provedor não é consultado na requisição, e por isso o reenvio nunca responde `503`
* Quando a entrega falha em definitivo, depois de esgotadas as tentativas do worker, o handler de desistência zera o contador de envios, o que devolve a cota e dispensa o cooldown do próximo reenvio. A etapa 15 descreve esse caminho

### Organização do código

* Rota em `src/routes/auth/resend-code.ts`, lendo o cookie e traduzindo o resultado do service em um dos três status. O resultado é discriminado (`sent`, `invalid-session`, `cooldown`, `limit-reached`), e os dois casos de 429 têm mensagens diferentes porque falam de estados do próprio cadastro de quem tem o cookie, não de outras contas
* Service em `src/plugins/app/auth/resend-code.ts`, montado pelo plugin `auth` junto dos outros fluxos e exposto como `fastify.auth.resendCode`
* A interface `AuthRepository` ganha `findPendingSignupBySessionToken` e `updatePendingSignupResendStateAndQueueEmail`. O segundo método recebe os cinco campos de uma vez junto da mensagem já renderizada e grava tudo numa transação só, o que torna o reenvio uma única escrita indivisível

### Logs

* Apenas identificador do cadastro pendente e identificador da mensagem no provedor
* O código nunca aparece em log e nunca é gravado em claro
* Erro de provedor é logado pelo worker do outbox, com o tipo da mensagem e o status devolvido, nunca com o corpo da resposta nem com o destinatário

## Definition of done

* Contrato publicado no OpenAPI, com os três status descritos
* Response tipada e validada por schema Zod
* Testes unitários cobrindo reenvio bem-sucedido, com hash novo, tentativas zeradas, expiração renovada e a mensagem enfileirada na mesma chamada
* Teste do cooldown, incluindo a exceção do contador zerado
* Teste do teto de envios verificando que nada é gravado e nada é enfileirado
* Teste de sessão inválida e expirada devolvendo o mesmo 401
* Testes de rota cobrindo os três status, com o cookie renovado apenas no sucesso
