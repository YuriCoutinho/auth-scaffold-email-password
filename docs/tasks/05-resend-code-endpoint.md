# 05. Resend code endpoint

## Introdução

Código de confirmação se perde. Cai em spam, chega atrasado, some junto com a aba fechada. Sem um caminho de reenvio, a única saída é esperar o cadastro expirar, e é aí que a pessoa desiste.

Por outro lado, este é o endpoint que mais chama o provedor de email, e provedor de email se paga por mensagem. Ele é o ponto natural para alguém transformar seu produto numa máquina de enviar email para terceiros. Por isso o controle de custo e abuso vive aqui, em camadas, e sempre antes de gastar a chamada.

Este é o caminho de reenvio de quem já tem o cookie. As regras de custo que ele cria, teto e cooldown, passam a valer também para o próprio cadastro, que nesta etapa ganha a capacidade de mandar um código novo quando a regra permite.

## Requisitos técnicos

### Contrato

* `POST /auth/resend-code`, sem body nenhum
* O cadastro pendente é identificado exclusivamente pelo token no cookie `signup_session`, buscado pelo hash dele em `verification_codes` com a finalidade `signup`. Não aceitar email como parâmetro é o que impede alguém de varrer endereços de terceiros disparando emails em nome do seu produto
* Sucesso responde `202` com mensagem condicional, no mesmo espírito genérico do cadastro, e renova o cookie com o mesmo token para acompanhar a nova validade. O token não rotaciona aqui porque quem chama já o tem e o endpoint não recebe endereço, então não há enumeração a evitar
* Cookie ausente, token desconhecido e código expirado respondem o mesmo `401`, sem diferenciar os três casos
* Documentado no OpenAPI com os quatro status possíveis

### Controles de custo, checados antes de gravar e de chamar o provedor

A ordem importa, e é teto primeiro, cooldown depois.

1. **Teto por código**: no máximo 5 envios no total, `MAX_CODE_SEND_COUNT`, contando o disparado pelo próprio cadastro. Atingido o teto, responde `429` explicando que só resta esperar o código expirar e começar de novo
2. **Cooldown**: 60 segundos desde o último envio, `RESEND_COOLDOWN_SECONDS`, medidos a partir de `issued_at`, respondendo `429` pedindo para aguardar, sem tocar o banco além da leitura e sem chamar o provedor

As duas constantes ficam em `src/lib/session.ts`, junto de `MAX_CODE_ATTEMPTS`, como a política de entrega compartilhada por todo fluxo que manda código.

O contador regressivo desabilitando o botão no front é usabilidade e não segurança. A barreira real precisa estar no servidor, porque o front é só uma sugestão para quem tem um cliente HTTP.

Existe uma exceção ao cooldown que vem da etapa anterior: quando o contador de envios está zerado, nenhum email foi entregue para o código atual, então não faz sentido cobrar espera de quem não recebeu nada.

### O cadastro passa pela mesma regra

A decisão de teto e cooldown vive no módulo de código, e o cadastro de um endereço ainda não confirmado passa a usá-la também. Com um código vivo que o teto ou o cooldown barram, o cadastro faz o que fazia, mantém o código e só rotaciona o token. Com um código vivo e a regra liberada, ele emite um código novo com a contagem somada em um e o envia, porque a pessoa que se cadastra de novo depois de um minuto quase sempre é alguém que não recebeu o primeiro email. Sem código vivo, ele emite do zero.

Ter uma regra só é o que impede o cadastro de virar um reenvio sem teto: repetir `POST /auth/signup` com o mesmo endereço custa exatamente o que custaria repetir `POST /auth/resend-code`.

### Reemissão

* Gera código novo, substitui o hash, zera o contador de tentativas, soma um à contagem de envios e grava `issued_at` com o instante atual, o que renova a validade pelo tempo de vida do código e começa o cooldown no mesmo gesto
* Zerar as tentativas é o que tira do limbo um cadastro cujo código foi invalidado por erros seguidos, e por isso o reenvio é a saída natural daquele estado
* Reaproveita a interface de envio e o template da etapa anterior, sem falar com o provedor diretamente

### Falha de envio com compensação completa

* A ordem é gravar primeiro e enviar depois, como no cadastro
* Antes de gravar, o estado anterior dos quatro campos do código, `code_hash`, `code_attempts`, `code_send_count` e `issued_at`, é capturado em memória
* Diferente do cadastro, aqui o envio é aguardado, porque quem chama já tem o token e a resposta pode dizer se o email saiu
* Se o envio falhar, os quatro campos voltam ao valor anterior, o que produz três efeitos desejáveis ao mesmo tempo: a cota não é consumida, o cooldown não começa e o código antigo volta a valer. A restauração é o mesmo compare-and-set da etapa anterior, guardado pelo `code_hash` que falhou e sem tocar no token
* A resposta nesse caso é `503` genérico, sem renovar o cookie
* A restauração é best-effort, ou seja, se ela própria falhar isso vira log de aviso e a resposta continua sendo 503, porque o que importa para quem chamou é saber que o envio não aconteceu

### Organização do código

* Rota em `src/routes/auth/resend-code.ts`, lendo o cookie e traduzindo o resultado do service em um dos quatro status. O resultado é discriminado (`sent`, `invalid-session`, `cooldown`, `limit-reached`, `email-unavailable`), e os dois últimos casos de 429 têm mensagens diferentes porque falam de estados do próprio cadastro de quem tem o cookie, não de outras contas
* Service em `src/plugins/app/auth/resend-code.ts`, montado pelo plugin `auth` junto dos outros fluxos e exposto como `fastify.auth.resendCode`. Ele só confere a presença do cookie e delega ao `resend` do módulo de código, que concentra busca, validade, teto, cooldown, envio e compensação
* A interface `AuthRepository` ganha `findVerificationCodeByTokenHash`, `saveVerificationCode` e `restoreVerificationCode`. A gravação é um upsert pela chave `(user_id, purpose)`, e a restauração recebe os quatro campos de uma vez, o que mantém a compensação como uma única escrita

### Logs

* Apenas id da conta, finalidade do código e identificador da mensagem no provedor
* O código nunca aparece em log e nunca é gravado em claro
* Erro de provedor é logado com o status da resposta, que é o suficiente para diagnosticar. O corpo não entra, porque pode ecoar o endereço do destinatário
* Uma restauração que falha vira log de aviso

## Definition of done

* Contrato publicado no OpenAPI, com os quatro status descritos
* Response tipada e validada por schema Zod
* Testes unitários cobrindo reenvio bem-sucedido, com hash novo, tentativas zeradas, `issued_at` renovado e ordem de gravar antes de enviar
* Teste do cooldown, incluindo a exceção do contador zerado
* Teste do teto de envios verificando que nada é gravado e o provedor não é chamado
* Teste de falha de envio conferindo campo a campo que o estado anterior foi restaurado, e um caso em que a própria restauração falha e a resposta continua 503
* Teste de sessão inválida e expirada devolvendo o mesmo 401
* Teste do cadastro provando que, com código vivo, ele só rotaciona o token dentro do cooldown e emite código novo fora dele
* Testes de rota cobrindo os quatro status, com o cookie renovado apenas no sucesso
