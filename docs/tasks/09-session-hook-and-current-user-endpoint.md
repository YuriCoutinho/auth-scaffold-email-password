# 09. Session hook and current user endpoint

## Introdução

Até aqui o servidor sabia criar sessão e não sabia ler sessão. A confirmação do cadastro e o login gravam uma linha em `sessions` e devolvem um cookie, mas nenhuma rota fazia o caminho de volta, ou seja, pegar aquele cookie e dizer quem é o dono dele. Sem esse caminho de volta, nenhuma rota consegue exigir autenticação, e todo o resto do produto fica travado.

Esta etapa entrega as duas pontas desse caminho, que só fazem sentido juntas. A primeira é um hook reaproveitável, aplicado antes do handler em qualquer rota protegida, que transforma o cookie numa identidade ou recusa a requisição. A segunda é `GET /me`, a primeira rota a usar o hook e o endpoint que o frontend chama no bootstrap para descobrir quem está logado. O hook sozinho não se prova, porque sem uma rota real ninguém exercita o caminho completo, e a rota sozinha não existe, porque ela é justamente o hook mais uma consulta. Por isso as duas entram na mesma entrega.

O que a sessão prova é um fato pontual, verificado no momento da requisição, e não um dado guardado para consulta rápida. A cada requisição o servidor hasheia o token do cookie, procura a linha correspondente e confere se ela continua viva. Isso custa uma consulta por requisição protegida, e é esse custo que compra a propriedade que interessa, que é a revogação imediata. Apagar ou marcar a linha derruba a sessão na requisição seguinte, sem esperar prazo nenhum.

O contraste com JWT deixa a troca explícita. Um token assinado dispensa a consulta, porque a própria assinatura carrega a prova, e em compensação vale até expirar, já que não existe nada para apagar. Quem escolhe JWT precisa depois inventar lista de revogação, tokens curtos com refresh e a complexidade que vem junto. Neste projeto a sessão em banco resolve o mesmo problema com uma consulta indexada por uma coluna única, e o logout de verdade sai de graça.

O cookie carrega um token aleatório de 32 bytes, nunca o identificador do usuário. Identificador é público e adivinhável, então usá-lo como credencial permitiria a qualquer pessoa se passar por qualquer conta apenas trocando um número. O token é imprevisível por construção, e o banco guarda somente o SHA-256 dele, de modo que vazar a tabela de sessões não entrega sessões utilizáveis.

## Requisitos técnicos

### O hook em `onRequest`

O hook é registrado como decorator da instância, `fastify.authenticate`, e cada rota protegida o declara no seu próprio `onRequest`. Decorator em vez de hook global porque rota pública e rota protegida convivem na mesma aplicação, e um hook global obrigaria uma lista de exceções que envelhece mal.

`onRequest` é o primeiro ciclo de vida do Fastify, antes do parse do corpo e antes da validação. Recusar ali significa que uma requisição sem sessão nunca gasta tempo desserializando o payload que mandou junto, o que fecha um vetor barato de abuso. Existe teste cobrindo exatamente isso, com um corpo JSON inválido que ainda assim recebe 401 em vez de 400, provando que a recusa acontece antes do parse.

### A divisão entre service puro e plugin

A regra de o que conta como sessão válida mora em `src/plugins/app/auth/authenticate.ts`, um service que recebe o token, devolve `{ outcome: "authenticated", user: { id } }` ou `{ outcome: "invalid" }` e não conhece requisição, resposta nem cookie. O plugin `src/plugins/app/authenticate.ts` é a casca HTTP, que lê o cookie, chama o service e traduz o resultado em 401 ou em `request.user`.

Essa divisão existe porque os casos difíceis são todos de regra, não de transporte. Sessão revogada, sessão expirada e sessão inexistente se testam sem subir servidor, injetando um repositório falso e um relógio fixo, e é assim que eles estão cobertos. O teste do plugin fica responsável apenas pelo que é HTTP, ou seja, o status, o corpo do erro e o momento em que a recusa acontece.

### `request.user` carregando só o `id`

O hook grava em `request.user` apenas o identificador interno do usuário. Ele não busca perfil, nome, papel nem qualquer outro dado, porque o único fato que a sessão prova é qual usuário está por trás daquele token. Tudo além disso é informação que a rota pode ou não precisar, e carregar para todas as rotas o que só uma delas usa é pagar consulta à toa em todo endpoint protegido que vier depois.

`GET /me` faz a segunda consulta por conta própria, e isso é deliberado. A rota que precisa descrever o usuário assume o custo de descrevê-lo; as demais, que só precisam saber de quem é a requisição, ficam com uma consulta só.

O identificador interno é sequencial e nunca sai do servidor. Ele serve para as chaves estrangeiras e para ligar as tabelas, enquanto o `publicId` em UUID é o que aparece nas respostas. Existe um teste garantindo que o corpo de `GET /me` não contém a chave `id`, porque expor um sequencial entregaria de brinde o tamanho da base de usuários.

### A regra de validade em TypeScript, não em SQL

A consulta ao repositório busca a sessão pelo hash do token e traz as colunas relevantes; quem decide se ela vale é o service, comparando `revokedAt` com `null` e `expiresAt` com o instante atual. Seria possível empurrar as duas condições para o `WHERE` e deixar o banco responder apenas quando a sessão estiver viva, mas o adaptador Drizzle não é coberto por teste neste projeto, já que a suíte roda só com mocks. Uma regra de segurança escrita dentro do SQL ficaria sem teste nenhum; escrita em TypeScript, ela é exercitada pelo repositório em memória e pelos testes do service.

A comparação de expiração é estrita, ou seja, uma sessão cujo `expiresAt` é exatamente o instante atual já está morta. O limite existe justamente para ser um limite, e aceitar o instante exato deixaria uma janela, ainda que mínima, em que uma sessão vencida continua passando. Há um teste dedicado a esse instante.

### O 401 genérico

Quatro caminhos de recusa produzem resposta byte a byte idêntica, com status `401` e a mensagem `Unauthorized.`: cookie ausente, token sem sessão correspondente, sessão revogada e sessão expirada. Distinguir os casos pareceria mais informativo, mas transformaria o endpoint num oráculo, permitindo a quem tem um token qualquer descobrir se ele já existiu, se foi revogado ou se apenas venceu.

A recusa também não limpa o cookie. Limpar exigiria mandar um `Set-Cookie` de expiração em toda requisição recusada, o que deixa o servidor respondendo a pedido de terceiro com uma alteração no estado do navegador da vítima. Além disso, um cookie inválido já é inofensivo: ele não abre nada, e o próprio `Max-Age` o remove no prazo. Quem apaga o cookie de propósito é o logout, que virá com a sua própria rota.

### `GET /me` como único lugar que descreve o usuário

`GET /me` responde `200` com `{ user: { publicId, email } }`, validado pelo `currentUserResponseSchema` em Zod e publicado no OpenAPI junto do formato do `401`. Ele é o único endpoint do sistema que descreve o usuário logado, e essa exclusividade é o ponto.

A consequência direta é que `POST /auth/login` e `POST /auth/verify-code` deixaram de devolver corpo e passaram a responder `204`. Do ponto de vista do cliente os dois fazem a mesma coisa, que é entregar o cookie de sessão, então respondem igual. Ter o login descrevendo o usuário criaria um segundo contrato de "usuário logado" em paralelo ao do `/me`, e dois contratos para o mesmo conceito divergem assim que um campo novo entra em um e não no outro. Com o `204`, o frontend tem um caminho só para aprender quem está logado, valendo tanto no boot quanto logo depois de autenticar.

Ficam de fora do corpo, além do óbvio token de sessão e do hash de senha, três campos que poderiam parecer naturais:

* `fullName` e os demais dados de perfil moram em `profiles`, a tabela que separa dado de autenticação de dado de produto. Trazê-los aqui custaria um join em toda chamada do bootstrap para servir um dado que a tela de perfil busca quando precisa
* `role` não existe no modelo, porque o projeto ainda não tem autorização por papel. Devolver um campo constante hoje só para ele já estar lá é resolver um problema que não apareceu
* `last_used_at` não é atualizado a cada requisição autenticada. Seria uma escrita em toda requisição protegida do sistema inteiro, em troca de um dado que ninguém lê ainda

### O consumo pelo frontend

A orientação vale igual em React, Vue ou Angular, mudando apenas o nome das peças.

* `GET /me` é chamado uma única vez, no bootstrap da aplicação, antes de montar a árvore de componentes e o roteador. Nunca dentro de um guard de rota nem de um componente individual, porque aí a mesma pergunta seria refeita a cada navegação
* O resultado fica num estado global em memória, acessível pela aplicação inteira
* Guards e rotas protegidas apenas leem esse estado já resolvido, sem disparar chamada nova
* Navegação client-side não remonta o bootstrap, então trocar de rota não gera requisição nova
* Login e logout atualizam esse mesmo estado diretamente, o primeiro chamando `GET /me` uma vez após o `204` e o segundo limpando o estado
* Entre o boot e a resposta convém um estado de carregamento, para não piscar a tela de deslogado antes de saber se existe sessão
* O usuário fica em memória e não em `localStorage`. O que autentica é o cookie `HttpOnly`, que o JavaScript não lê, e guardar uma cópia do usuário em storage cria um segundo lugar que pode discordar do servidor e sobrevive ao logout

## Definition of done

* Hook validando a sessão pelo hash do token, com cookie ausente, sessão inexistente, sessão revogada, sessão expirada e sessão expirando no instante exato cobertos por teste
* Recusa acontecendo em `onRequest`, com teste provando que o corpo da requisição não chega a ser parseado
* `GET /me` respondendo `200` com `publicId` e `email`, e teste garantindo que o identificador interno não aparece no corpo
* `GET /me` respondendo o mesmo `401` genérico nos quatro caminhos de recusa
* Sessão válida apontando para usuário inexistente falhando alto, com o error handler respondendo `500` genérico em vez de disfarçar de `401`
* `POST /auth/login` e `POST /auth/verify-code` respondendo `204` sem corpo, com o cookie de sessão intacto
* Contratos das três rotas publicados no OpenAPI, incluindo o formato do erro
* Request e response tipados e validados por schema Zod
* `pnpm test`, `pnpm typecheck`, `pnpm lint` e `pnpm build` verdes
