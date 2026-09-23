# 15. Email outbox

## Introdução

Até aqui todo email deste projeto saiu dentro da requisição que o motivou. O cadastro gravava o pendente e só então chamava o provedor, o reenvio fazia o mesmo, e a troca de senha aguardava o aviso antes de responder. Isso tem duas consequências desconfortáveis. A primeira é de latência, porque quem se cadastra espera a ida e a volta até um serviço de terceiro para receber uma resposta que não depende dele. A segunda é de correção, porque uma indisponibilidade momentânea do provedor virava um `503` para quem apenas queria criar uma conta, e o sistema precisava desfazer à mão o que tinha acabado de gravar.

Esta etapa tira a entrega do caminho da requisição. Enviar um email passa a ser gravar uma linha numa tabela, na mesma transação da escrita de domínio que pede o envio, e um worker em segundo plano entrega essa linha depois, com novas tentativas quando o provedor falha. A requisição volta a depender apenas do banco, que é a dependência que ela já tinha de qualquer forma, e o cadastro responde `202` sem nunca consultar o provedor.

O desenho é o padrão transactional outbox. A novidade em relação ao resto do projeto é que ele traz a primeira peça de trabalho em segundo plano, com tudo o que isso implica de ciclo de vida, encerramento limpo e concorrência entre processos.

## Requisitos técnicos

### Uma fatia nova, genérica, que não conhece autenticação

O outbox nasce como `src/plugins/app/email-outbox/`, no mesmo formato das fatias anteriores. O `index.ts` é o plugin e decora `fastify.emailOutbox`, `repository.ts` é a porta `EmailOutboxRepository`, `drizzle-repository.ts` é o adaptador dela, e `worker.ts` é a entrega propriamente dita. A regra de dependência de mão única que separa `auth` de `sessions` vale igual aqui: `auth` importa de `email-outbox`, e nenhum arquivo de `email-outbox` importa de `auth`. O outbox é infraestrutura, ele transporta mensagens já prontas e não sabe o que é um código de confirmação.

O que faz essa fronteira se sustentar é a coluna `type`. Ela guarda um nome livre, definido pelo domínio que enfileira, e o outbox só a usa para escolher a política de repetição e para chamar o handler de desistência que alguém registrou para aquele nome. O domínio registra esse handler chamando `fastify.emailOutbox.onGiveUp`, e a seta continua apontando numa direção só.

### Uma fila em Postgres, e não uma fila dedicada

A alternativa óbvia seria uma fila de verdade, Redis, SQS ou equivalente. Ela não entra aqui por um motivo que é o ponto inteiro desta etapa: a garantia que se quer é que o email só exista se a escrita de domínio existir, e vice-versa. Com uma fila externa, gravar o cadastro pendente e publicar a mensagem são dois sistemas diferentes, sem transação comum, e o resultado é o problema clássico da escrita dupla, com códigos enviados para cadastros que sofreram rollback e cadastros gravados cuja mensagem nunca foi publicada.

Guardando a mensagem numa tabela do mesmo banco, o enfileiramento entra na mesma transação da escrita que o causou e o problema simplesmente não existe. Some também um componente de infraestrutura para operar, monitorar e pagar, num projeto que já depende de Postgres de qualquer maneira. O custo é que a fila roda sobre um banco relacional, o que só seria um problema num volume que este projeto não tem e que, quando tiver, se resolve movendo a implementação da porta sem tocar em nenhum service.

### A linha carrega a mensagem renderizada

A tabela `email_outbox` guarda `type`, `recipient`, `subject`, `html` e `text`, ou seja, a mensagem inteira já montada, e não uma referência a template mais um punhado de parâmetros. Isso é possível porque os templates deste projeto são funções puras sem nenhum I/O, então renderizar no momento do enfileiramento não custa nada nem exige contexto.

A escolha compra duas coisas. A primeira é que o worker fica livre de conhecimento de domínio, porque entregar uma linha é copiar cinco campos para o `EmailSender` e nada mais. A segunda é que a linha é autocontida no tempo: uma mensagem enfileirada por um deploy antigo continua saindo exatamente como foi escrita, mesmo que o template mude antes de ela ser entregue. Como contrapartida, o corpo do email fica gravado no banco, o que é aceitável porque esse corpo é sempre gerado pelo próprio sistema e não carrega dado de terceiro.

O `status` é um `text` simples com os valores permitidos vivendo no TypeScript, mesma decisão que `revoked_reason` já tinha tomado, para que acrescentar um estado depois não exija migration. O índice é composto por `status` e `next_attempt_at`, que são exatamente as duas colunas da consulta que o worker faz o tempo todo.

### `next_attempt_at` é também o lease

Quando o worker reivindica uma linha, ele empurra `next_attempt_at` para o futuro antes de tentar entregar. A coluna que diz quando tentar de novo passa assim a dizer também até quando aquela linha está reservada, e isso elimina a necessidade de uma coluna de lease, de um status intermediário de "em processamento" e, principalmente, de um processo de limpeza.

O caso que motiva a decisão é o processo que morre no meio de um envio. Com um status intermediário, aquela linha ficaria travada para sempre até alguém passar e destravá-la. Com o lease embutido no agendamento, ela simplesmente volta a ficar vencida quando o prazo passa, e o próximo ciclo a pega de novo sem nenhuma intervenção. O preço é que o mesmo email pode sair duas vezes se a entrega tiver sucedido mas o processo morrer antes de gravar, o que é a garantia de entrega ao menos uma vez que qualquer fila oferece e que um código de confirmação repetido não quebra.

### O worker roda no mesmo processo, e `FOR UPDATE SKIP LOCKED` faz isso escalar mesmo assim

O worker vive dentro da aplicação Fastify, agendado pelo próprio plugin. Um processo separado só para entregar email seria mais uma unidade para implantar, observar e manter viva, o que não se justifica num volume em que a entrega é alguns emails por minuto.

Isso poderia virar um problema no dia em que a aplicação subir em mais de uma réplica, porque passariam a existir vários workers olhando a mesma tabela. O que impede isso de virar email duplicado é a consulta de reivindicação, que seleciona as linhas vencidas com `FOR UPDATE SKIP LOCKED` e, na mesma transação, empurra o `next_attempt_at` delas. O `SKIP LOCKED` faz cada worker ignorar as linhas que outro já está segurando, em vez de esperar por elas, então dois processos concorrentes pegam conjuntos disjuntos e ninguém bloqueia ninguém. A mesma cláusula protege contra o worker do próprio processo, caso um ciclo demore mais que o intervalo.

O agendamento usa um `setTimeout` que se reagenda ao terminar, e não um `setInterval`, para que um lote lento nunca se sobreponha a si mesmo. O timer recebe `unref`, de modo que uma espera pendente sozinha não segure o processo vivo, e um hook `onClose` limpa o timer e aguarda o lote em andamento, para que o encerramento não corra contra o fechamento do pool de conexões.

Há um detalhe que vale fixar: sob o Vitest, um laço de polling ativo segura o event loop e vaza de uma suíte para outra. Por isso o worker só liga quando `startEmailWorker` diz explicitamente que sim ou quando o ambiente não é de teste, e o helper de opções dos testes deixa esse sinalizador desligado. Os testes exercitam a entrega chamando `fastify.emailOutbox.processBatch()`, que roda exatamente um ciclo sem envolver relógio nenhum.

### Polling, e não `LISTEN`/`NOTIFY`

O Postgres oferece `LISTEN`/`NOTIFY`, e ele entregaria a mensagem com latência menor que um intervalo de polling. Ele não é usado aqui porque resolve apenas metade do problema. A notificação é disparada no commit e não é persistida, então um worker que estiver reiniciando naquele instante perde o aviso, e a linha ficaria parada até alguém consultar a tabela de qualquer forma. Ou seja, o polling continuaria necessário como rede de segurança, e o resultado seria dois caminhos para manter em vez de um.

Além disso, a notificação exige uma conexão dedicada em escuta permanente, o que atrapalha quem usa pool. Com um intervalo de um segundo, a latência adicionada é irrelevante diante do tempo que o provedor leva para entregar o email, e o mecanismo é uma consulta indexada e nada mais.

### A política de repetição muda conforme o tipo

Cada tipo de email tem um prazo próprio, e tratar todos igual erraria nas duas pontas. O código de confirmação morre junto com o cadastro pendente, em quinze minutos, então insistir por uma hora entregaria um código já inválido, o que é pior do que não entregar, porque o usuário digita algo que o sistema recusa. Já o aviso de senha alterada não tem prazo nenhum, e vale persegui-lo por bem mais tempo, porque ele existe para que o dono da conta descubra um acesso indevido.

Por isso `policyFor` devolve uma política por tipo: `signup_code` tem três tentativas com esperas de dez e trinta segundos, e `password_changed` tem cinco tentativas com esperas de trinta segundos, dois, dez e trinta minutos. Os números ficam numa constante única ao lado da função, cada entrada sendo uma espera, de forma que o número de tentativas é o tamanho da lista mais a primeira. Um tipo desconhecido cai numa política intermediária, porque um email sem política declarada ainda deve sair.

Quando a última tentativa falha, a linha vai para `failed` e para de ser reivindicada. A coluna `last_error` guarda apenas a mensagem do erro, nunca o corpo da resposta do provedor, porque esse corpo costuma ecoar o endereço de destino. O log do worker é ainda mais restrito e registra somente o identificador da linha, o tipo, o número de tentativas e, quando existe, o status HTTP devolvido pelo provedor.

### O enfileiramento acontece dentro da transação do domínio, no repositório

A garantia que justifica todo o resto é que a linha do outbox e a escrita que a motivou vivem ou morrem juntas. Para isso, a transação fica no repositório Drizzle, seguindo o precedente que `promotePendingSignup` e `changeUserPassword` já tinham estabelecido, e não no service. O service continua conversando com uma interface só, e o adaptador em memória dos testes oferece a mesma garantia de graça, porque escrever em dois arrays em sequência já é indivisível.

Na prática, `AuthRepository` troca `upsertPendingSignup` por `upsertPendingSignupAndQueueEmail` e `updatePendingSignupResendState` por `updatePendingSignupResendStateAndQueueEmail`, ambos recebendo a mensagem já renderizada junto dos campos do cadastro, e `changeUserPassword` ganha esse mesmo parâmetro. Os nomes antigos desaparecem em vez de conviverem com os novos, porque um caminho de escrita que não enfileira é exatamente o caminho pelo qual a atomicidade voltaria a se perder. Dentro da transação, o adaptador constrói `createDrizzleEmailOutboxRepository(tx)` e chama `enqueue`, do mesmo jeito que já construía o repositório de sessões sobre a transação aberta.

Com isso os services `signup`, `resend-code` e `change-password` passam a renderizar a mensagem e entregá-la ao repositório, e os módulos `send-signup-code.ts` e `send-password-changed.ts` deixam de existir. Manter um segundo caminho de entrega em pé seria manter viva a chance de os dois divergirem.

### `signup` e `resend-code` não respondem mais `503`

Como nenhuma das duas rotas fala com o provedor, nenhuma delas tem como saber que ele está fora, e o `503` sai do contrato das duas, junto com a entrada correspondente no schema de resposta. O cadastro responde `202` com o cookie em todos os caminhos aceitos, e o reenvio responde `202` renovando o cookie. Os resultados discriminados perdem o membro `email-unavailable`, o que é o mesmo fato dito em TypeScript.

A mudança melhora a resposta em dois sentidos ao mesmo tempo. O usuário deixa de receber um erro por algo que não depende dele e que provavelmente se resolve sozinho em segundos, e o contrato fica mais honesto, porque `202` sempre significou "aceitei e vou processar", que é literalmente o que agora acontece.

### A compensação de entrega migra para a desistência

O cadastro tinha uma compensação importante: quando a entrega falhava, o contador `code_send_count` voltava a zero, estabelecendo que nenhum email saiu para o código atual, e o reenvio tratava esse estado como livre de cooldown e de cota. Sem ela, uma falha do provedor gastaria a cota de quem nunca recebeu nada. O reenvio tinha a sua própria versão, restaurando os cinco campos do estado anterior.

Essa proteção continua existindo, mas muda de lugar e de gatilho. O plugin `auth` registra, para o tipo `signup_code`, um handler que chama `markPendingSignupUndelivered` com o destinatário, e o worker o executa quando desiste em definitivo de uma linha. A restauração completa do reenvio some junto com a estrutura que a exigia, porque agora o estado novo e a mensagem entram numa escrita só e não há nada a desfazer.

A diferença para o usuário é uma melhora. Antes, uma única tentativa malsucedida já disparava a compensação, mesmo quando o provedor estava apenas oscilando e o email seria entregue na tentativa seguinte. Agora, falhas passageiras não penalizam ninguém, porque o worker insiste sozinho, e a cota só é devolvida quando a entrega falhou de verdade, depois de esgotadas as tentativas da política. Vale notar que, no caso do código de confirmação, essa política termina bem antes dos quinze minutos de vida do cadastro, então quem desistiu de esperar ainda encontra o reenvio liberado.

## Definition of done

* Tabela `email_outbox` criada por migration, com o índice composto de `status` e `next_attempt_at`, e nenhuma outra alteração de schema na mesma migration
* Porta `EmailOutboxRepository` com `enqueue`, `claimDue`, `markSent`, `reschedule` e `giveUp`, adaptador Drizzle usando `FOR UPDATE SKIP LOCKED` na reivindicação e adaptador em memória espelhando a mesma semântica de lease
* Teste do adaptador em memória cobrindo que só linhas pendentes e vencidas são reivindicadas, que uma segunda reivindicação na mesma janela não devolve nada, que o lease vencido torna a linha elegível de novo, que o limite é respeitado e que `last_error` guarda apenas a mensagem do erro
* `createEmailOutboxWorker` expondo `processBatch` sem nenhum timer, coberto por teste no envio, na reprogramação com a espera da política, na desistência ao atingir o teto, na chamada única do handler de desistência, na continuidade do lote quando uma mensagem falha e na ausência de destinatário e de corpo do provedor nos logs
* Plugin decorando `fastify.emailOutbox` com `enqueue`, `processBatch` e `onGiveUp`, agendando por `setTimeout` reagendado com `unref`, encerrando o laço e aguardando o lote em andamento no `onClose`
* Worker desligado por padrão em ambiente de teste, com o helper de opções fixando `startEmailWorker` em `false` e a suíte inteira encerrando sozinha
* `AuthRepository` enfileirando o email na mesma transação da escrita de domínio nos três fluxos, com os métodos antigos removidos e os módulos de envio direto apagados
* `POST /auth/signup` e `POST /auth/resend-code` sem `503` no contrato nem no OpenAPI, respondendo `202` com o cookie mesmo quando o provedor está fora
* Handler de desistência do tipo `signup_code` zerando `code_send_count`, coberto por teste, e um teste provando que a desistência de um aviso de senha não toca cadastro pendente nenhum
* `pnpm typecheck`, `pnpm lint`, `pnpm test` e `pnpm build` verdes
