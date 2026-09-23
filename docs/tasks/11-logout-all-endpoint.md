# 11. Logout all endpoint

## Introdução

O logout da etapa anterior resolve o dispositivo que está na mão de quem clica, e só ele. Falta a ação que alguém procura quando desconfia que a conta foi alcançada por outra pessoa, que é derrubar tudo de uma vez, sem saber onde a sessão intrusa está nem em que aparelho ela foi criada.

Esta etapa entrega `POST /auth/logout-all`, que revoga todas as sessões do usuário autenticado. Por padrão a sessão que está fazendo a requisição é preservada, e um sinalizador opcional no corpo derruba ela junto. A diferença entre os dois comportamentos é só essa, e ela existe porque as duas expectativas são legítimas dependendo de onde o botão está na interface.

A etapa também ajusta o hook `authenticate`, que passa a publicar a sessão do request ao lado do usuário. Esse é o pedaço de infraestrutura que faltava para uma rota poder dizer "todas menos esta" sem voltar ao cookie, e ele vem de graça, porque o hook já resolvia a linha da sessão e estava jogando metade dela fora.

Diferente do logout simples, aqui a autenticação é obrigatória. A operação escreve em nome de um usuário específico, então precisa saber de quem está falando, e um cookie inválido recebe `401` como em qualquer rota protegida.

## Requisitos técnicos

### O hook publica `request.session` ao lado de `request.user`

O hook `authenticate` já fazia o `SELECT` que encontra a linha da sessão pelo hash do token, e era dessa linha que ele tirava o `user_id` para expor `request.user`. O `id` da própria sessão estava ali, no mesmo objeto, e era descartado.

Fazer a rota derivar a sessão de novo, lendo `request.cookies`, hasheando o token e consultando o banco outra vez, seria recalcular o que já estava em mãos. Pior que o custo, seria criar dois jeitos de nomear a mesma sessão dentro de um único request, e qualquer divergência entre eles ficaria escondida até virar bug. Então o hook passa a publicar as duas metades, e `AuthenticateResult` autenticado cresce para `{ outcome, user, session }`.

O invariante que sai disso vale para esta rota e para toda rota protegida que venha depois: quem está atrás do hook não lê `request.cookies`, usa `request.session.id`. O cookie é assunto do hook, e ninguém mais precisa saber que ele existe.

### `session` é irmão de `user`, e não um campo dentro dele

A alternativa seria expor `request.user.sessionId`, o que economiza uma propriedade decorada. Ela foi descartada porque usuário e sessão são entidades distintas, com ciclos de vida distintos: um usuário tem muitas sessões, e uma sessão morre sem que o usuário morra junto.

Tratar a sessão como atributo do usuário faria o tipo mentir sobre isso. Com ela em `request.session`, o dia em que a sessão precisar expor mais campos, como o rótulo do dispositivo ou o momento da criação, o lugar já existe e nada precisa ser movido.

Ambas as propriedades são decoradas com `decorateRequest` e nascem `null`, para que toda requisição carregue o campo e uma rota que esqueça o hook leia `null` em vez de `undefined`. O Fastify lança se o nome já estiver ocupado, e `session` está livre porque quem decoraria esse nome é o `@fastify/session`, que não faz parte do projeto. Isso não foi assumido, foi fixado por um teste que registra uma rota sem o hook e prova que a aplicação sobe e que os dois campos chegam nulos.

### Preservar a sessão atual é o padrão, derrubar tudo é opt-in

Os dois comportamentos existem em produtos conhecidos, e nenhum dos dois é errado. A escolha aqui é pelo padrão que não surpreende: quem aperta "sair de todos os dispositivos" está agindo de dentro de um aparelho em que confia, normalmente logo depois de trocar a senha ou de ver um acesso estranho, e ser deslogado desse aparelho no mesmo instante é um efeito colateral que ninguém pediu.

Quem quiser o contrário manda `includeCurrentSession: true`, e aí a sessão atual entra no lote e o cookie é limpo. É a escolha certa para um aparelho emprestado, em que a intenção é justamente não deixar rastro.

### O parâmetro é corpo JSON opcional, com default

O sinalizador não vai em query string porque ele é parte do que a requisição pede, não um filtro de leitura, e `POST` com efeito colateral tem corpo. Também não é corpo obrigatório, porque um botão de "sair de todos" no frontend é um `fetch(url, { method: "POST" })` sem nada a dizer, e exigir `{}` seria empurrar cerimônia para o cliente em troca de nada.

O schema resolve as duas ausências possíveis: o campo faltando dentro de um corpo que chegou, e o corpo inteiro faltando. O primeiro caso é o `default(false)` do campo. O segundo precisa de `prefault({})`, e não de `default`, porque no Zod 4 o `default` recebe o tipo de saída, de modo que `{}` não passaria no compilador, enquanto o `prefault` entrega `{}` como entrada e deixa o default interno preencher. Na declaração da rota o schema ainda é marcado como aceitando ausência, porque uma requisição sem corpo nenhum chega ao validador como `null`, e não como `undefined`.

### A resposta é `204`, sem contagem

O service conta quantas sessões foram revogadas, e a rota não devolve esse número. Ninguém consome a contagem hoje: a interface que mostra dispositivos conectados, em que esse dado teria uso, é outra etapa, e quando ela chegar vai precisar da lista, não de um total solto.

Devolver um corpo agora significaria fixar um contrato antes de existir um leitor para ele. A contagem existe onde ela tem valor imediato, que é no log, ao lado do `userId` e do escopo da operação.

### O service devolve `currentSessionRevoked`, mesmo espelhando a entrada

`LogoutAllResult` carrega `currentSessionRevoked`, que hoje é exatamente o valor de `includeCurrentSession` que entrou. A redundância é deliberada, e não sobra a ser removida.

A pergunta que a rota precisa responder antes de limpar o cookie é "esse cookie ainda vale?", e essa regra tem um dono só, que é o service. Se a rota decidisse por conta própria olhando o sinalizador de entrada, a mesma regra passaria a existir em dois lugares, e a primeira vez que a revogação ganhasse uma condição a mais, como uma sessão que não pode ser derrubada, a rota continuaria limpando o cookie sem saber que mudou algo. Do jeito que está, a rota limpa o cookie quando, e somente quando, o service diz que a sessão atual caiu.

### A revogação em lote guarda `revoked_at IS NULL`

`revokeAllUserSessions` faz um `UPDATE` filtrando por `user_id`, por `revoked_at IS NULL` e, quando há exclusão, por `id <>`. A guarda do nulo é a mesma do logout simples e entrega as mesmas duas propriedades.

A primeira é a idempotência: uma segunda chamada seguida casa zero linhas, então ela não sobrescreve o carimbo que a primeira deixou. A segunda é a honestidade da contagem, porque `revokedCount` vem do `returning` e conta só o que esta chamada de fato revogou, em vez de somar de novo o que já estava revogado antes.

A guarda não olha `expires_at`, de propósito. Uma sessão vencida mas nunca revogada entra no lote e recebe `revoked_reason` igual a `logout_all`, porque expiração e revogação são colunas independentes e o que o registro conta é que o usuário mandou derrubar tudo.

A exclusão da sessão atual é opcional na assinatura, e ausente quer dizer "revogue literalmente todas". No adaptador Drizzle isso vira um argumento `undefined` dentro do `and()`, que o Drizzle ignora, então a cláusula fica condicional sem precisar montar duas queries.

### Nenhuma migration foi necessária

A união `RevokedReason` ganhou `logout_all` ao lado de `user_logout`, e o banco não mudou. `revoked_reason` é `text` no Postgres, conforme a decisão tomada na etapa do logout, e a restrição de valores vive em `REVOKED_REASONS`, no TypeScript.

Esse é o retorno concreto daquela escolha. Com um `pgEnum`, acrescentar um motivo seria uma migration, e migration de enum é a operação que envelhece pior justamente enquanto a lista ainda cresce. Aqui a lista cresceu com uma linha de código, e o compilador continua sendo o único caminho até aquela coluna.

### O endpoint não pede a senha

Uma reautenticação antes de derrubar tudo parece prudente, e neste caso trabalha contra o objetivo. Quem aciona esta rota normalmente está reagindo a uma suspeita de acesso indevido, e a ação é a própria defesa: cada segundo entre a suspeita e a revogação é tempo que a sessão intrusa continua viva.

Além disso, quem já está autenticado passou pelo hook, então a identidade está provada na medida em que o resto do sistema exige. Pedir a senha de novo só adiciona atrito, e um atrito que também atrapalha quem esqueceu a senha e está justamente tentando se proteger.

O log registra o evento com `userId`, `revokedCount` e `includeCurrentSession`, porque derrubar todos os dispositivos é sinal de segurança e não rotina. Nenhum token, email ou hash aparece nessa linha.

## Definition of done

* `POST /auth/logout-all` respondendo `204` sem corpo, com o contrato publicado no OpenAPI
* Rota atrás do hook `authenticate`, respondendo `401` genérico quando o cookie está ausente, desconhecido, revogado ou expirado
* Corpo ausente, corpo vazio e `includeCurrentSession` ausente resultando no padrão que preserva a sessão atual
* `includeCurrentSession` não booleano respondendo `400`
* Demais sessões do usuário marcadas com `revoked_at` e `revoked_reason` igual a `logout_all`
* Sessão atual intacta e cookie não limpo quando o padrão vale
* Sessão atual revogada e cookie limpo com `Max-Age=0`, `HttpOnly`, `Secure`, `SameSite=Strict` e `Path=/` quando `includeCurrentSession` é verdadeiro
* Sessões de outros usuários intactas, com teste provando o isolamento
* Usuário sem nenhuma outra sessão recebendo `204`, com contagem zero
* Segunda chamada seguida preservando o carimbo da primeira revogação
* Sessão expirada e ainda não revogada entrando no lote
* `request.user` e `request.session` disponíveis em rota protegida e nulos em rota que não usa o hook
* `pnpm test`, `pnpm typecheck`, `pnpm lint` e `pnpm build` verdes
