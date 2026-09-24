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
* Documentado no OpenAPI com os quatro status possíveis

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

### Falha de envio com compensação completa

* A ordem é gravar primeiro e enviar depois, como no cadastro
* Antes de gravar, o estado anterior dos cinco campos é capturado em memória
* Se o envio falhar, todos os cinco campos voltam ao valor anterior, o que produz três efeitos desejáveis ao mesmo tempo: a cota não é consumida, o cooldown não começa e o código antigo volta a valer
* A resposta nesse caso é `503` genérico, sem renovar o cookie
* A restauração é best-effort, ou seja, se ela própria falhar isso vira log de aviso e a resposta continua sendo 503, porque o que importa para quem chamou é saber que o envio não aconteceu

### Organização do código

* Rota em `src/routes/auth/resend-code.ts`, lendo o cookie e traduzindo o resultado do service em um dos quatro status. O resultado é discriminado (`sent`, `invalid-session`, `cooldown`, `limit-reached`, `email-unavailable`), e os dois últimos casos de 429 têm mensagens diferentes porque falam de estados do próprio cadastro de quem tem o cookie, não de outras contas
* Service em `src/plugins/app/auth/resend-code.ts`, montado pelo plugin `auth` junto dos outros fluxos e exposto como `fastify.auth.resendCode`
* A interface `AuthRepository` ganha `findPendingSignupBySessionToken` e `updatePendingSignupResendState`. O segundo método serve tanto para gravar o código novo quanto para restaurar o estado anterior quando o envio falha, recebendo os cinco campos de uma vez, o que mantém a compensação como uma única escrita

### Logs

* Apenas identificador do cadastro pendente e identificador da mensagem no provedor
* Token desconhecido e cadastro expirado respondem o mesmo 401, mas são logados separadamente, um sem identificador nenhum e o outro com o identificador do cadastro. A resposta continua indistinguível para quem chamou, e a investigação deixa de confundir sessão de cadastro morta com abuso
* O código nunca aparece em log e nunca é gravado em claro
* Erro de provedor é logado com status e corpo da resposta, que é o suficiente para diagnosticar sem registrar o conteúdo enviado

## Definition of done

* Contrato publicado no OpenAPI, com os quatro status descritos
* Response tipada e validada por schema Zod
* Testes unitários cobrindo reenvio bem-sucedido, com hash novo, tentativas zeradas, expiração renovada e ordem de gravar antes de enviar
* Teste do cooldown, incluindo a exceção do contador zerado
* Teste do teto de envios verificando que nada é gravado e o provedor não é chamado
* Teste de falha de envio conferindo campo a campo que o estado anterior foi restaurado, e um caso em que a própria restauração falha e a resposta continua 503
* Teste de sessão inválida e expirada devolvendo o mesmo 401
* Testes de rota cobrindo os quatro status, com o cookie renovado apenas no sucesso
