# 11. Endpoint DELETE /sessions

## Introdução

O logout da etapa anterior resolve o dispositivo que está na mão de quem clica, e só ele. Falta a ação que alguém procura quando desconfia que a conta foi alcançada por outra pessoa, que é derrubar tudo de uma vez, sem saber onde a sessão intrusa está nem em que aparelho ela foi criada.

Esta etapa entrega `DELETE /sessions`, que revoga todas as sessões do usuário autenticado menos a que está fazendo a requisição. A sessão atual é sempre preservada, sem sinalizador nenhum para negociar isso, e quem quiser derrubar tudo inclusive a própria chama `DELETE /sessions` e em seguida `DELETE /sessions/current`.

O endereço é a coleção inteira, e o verbo diz o que acontece com ela. `DELETE /sessions` apaga as sessões do usuário, `DELETE /sessions/current` apaga só a deste dispositivo, e as duas convivem na mesma coleção sem que nenhuma precise de parâmetro para decidir qual das duas coisas está fazendo.

A etapa também ajusta o hook `authenticate`, que passa a publicar a sessão do request ao lado do usuário. Esse é o pedaço de infraestrutura que faltava para uma rota poder dizer "todas menos esta" sem voltar ao cookie, e ele vem de graça, porque o hook já resolvia a linha da sessão e estava jogando metade dela fora.

Diferente do logout simples, aqui a autenticação é obrigatória. A operação escreve em nome de um usuário específico, então precisa saber de quem está falando, e um cookie inválido recebe `401` como em qualquer rota protegida.

## Requisitos técnicos

### Onde o código fica

A rota é `src/routes/sessions/all.ts`, o service é `src/plugins/app/sessions/logout-all.ts` e a fatia expõe os dois por `fastify.sessions.logoutAll`, montado em `create-sessions.ts`. O acesso ao banco é `revokeAllUserSessions`, declarado na porta `SessionRepository` ao lado dos outros métodos de sessão, nunca em `AuthRepository`.

### O hook publica `request.session` ao lado de `request.user`

O hook `authenticate` já fazia o `SELECT` que encontra a linha da sessão pelo hash do token, e era dessa linha que ele tirava o `user_id` para expor `request.user`. O `id` da própria sessão estava ali, no mesmo objeto, e era descartado.

Fazer a rota derivar a sessão de novo, lendo `request.cookies`, hasheando o token e consultando o banco outra vez, seria recalcular o que já estava em mãos. Pior que o custo, seria criar dois jeitos de nomear a mesma sessão dentro de um único request, e qualquer divergência entre eles ficaria escondida até virar bug. Então o hook passa a publicar as duas metades, e `AuthenticateResult` autenticado cresce para `{ outcome, user, session }`.

O invariante que sai disso vale para esta rota e para toda rota protegida que venha depois: quem está atrás do hook não lê `request.cookies`, usa `request.session.id`. O cookie é assunto do hook, e ninguém mais precisa saber que ele existe.

### `session` é irmão de `user`, e não um campo dentro dele

A alternativa seria expor `request.user.sessionId`, o que economiza uma propriedade decorada. Ela foi descartada porque usuário e sessão são entidades distintas, com ciclos de vida distintos: um usuário tem muitas sessões, e uma sessão morre sem que o usuário morra junto.

Tratar a sessão como atributo do usuário faria o tipo mentir sobre isso. Com ela em `request.session`, o dia em que a sessão precisar expor mais campos, como o rótulo do dispositivo ou o momento da criação, o lugar já existe e nada precisa ser movido.

Ambas as propriedades são decoradas com `decorateRequest` e nascem `null`, para que toda requisição carregue o campo e uma rota que esqueça o hook leia `null` em vez de `undefined`. O Fastify lança se o nome já estiver ocupado, e `session` está livre porque quem decoraria esse nome é o `@fastify/session`, que não faz parte do projeto. Isso não foi assumido, foi fixado por um teste que registra uma rota sem o hook e prova que a aplicação sobe e que os dois campos chegam nulos.

### A sessão atual é sempre preservada, e não há sinalizador

Quem aperta "sair de todos os dispositivos" está agindo de dentro de um aparelho em que confia, normalmente logo depois de trocar a senha ou de ver um acesso estranho, e ser deslogado desse aparelho no mesmo instante é um efeito colateral que ninguém pediu. Esse é o comportamento que a rota entrega, sempre, e a exclusão da sessão atual não é negociável por parâmetro.

Derrubar tudo inclusive a própria sessão continua possível, e é a composição das duas rotas: `DELETE /sessions` seguido de `DELETE /sessions/current`. O resultado é o mesmo, cada chamada tem um significado só, e a segunda já sabe limpar o cookie porque essa sempre foi a responsabilidade dela.

### A rota não tem corpo

Sem sinalizador, não sobra nada para o cliente dizer além do que o cookie e o método já dizem, então a rota não declara `body` nenhum. Um botão de "sair de todos" no frontend vira um `fetch(url, { method: "DELETE" })` seco, sem header de tipo e sem payload, e não existe forma de escrever essa chamada que resulte em `400` por causa do corpo.

Isso também elimina uma classe inteira de detalhe que um corpo opcional arrasta atrás de si, que é distinguir corpo ausente de corpo vazio e decidir o que cada um significa. Um endpoint que não lê corpo não precisa responder a essa pergunta.

### A resposta é `204`, sem contagem

O service conta quantas sessões foram revogadas, e a rota não devolve esse número. Ninguém consome a contagem hoje: a interface que mostra dispositivos conectados, em que esse dado teria uso, é outra etapa, e quando ela chegar vai precisar da lista, não de um total solto.

Devolver um corpo agora significaria fixar um contrato antes de existir um leitor para ele. A contagem existe onde ela tem valor imediato, que é no log, ao lado do `userId`.

### O cookie nunca é limpo por esta rota

Como a sessão atual sempre sobrevive, o cookie que chegou continua valendo depois da resposta, e mandar um `Set-Cookie` de expiração aqui apagaria uma sessão que o próprio servidor acabou de preservar. `LogoutAllResult` carrega só `revokedCount`, a rota não tem decisão de cookie para tomar, e quem apaga cookie no projeto é `DELETE /sessions/current`, que existe justamente para isso.

### A revogação em lote guarda `revoked_at IS NULL`

`revokeAllUserSessions`, na porta `SessionRepository`, faz um `UPDATE` filtrando por `user_id`, por `revoked_at IS NULL` e, quando há exclusão, por `id <>`. A guarda do nulo é a mesma do logout simples e entrega as mesmas duas propriedades.

A primeira é a idempotência: uma segunda chamada seguida casa zero linhas, então ela não sobrescreve o carimbo que a primeira deixou. A segunda é a honestidade da contagem, porque `revokedCount` vem do `returning` e conta só o que esta chamada de fato revogou, em vez de somar de novo o que já estava revogado antes.

A guarda não olha `expires_at`, de propósito. Uma sessão vencida mas nunca revogada entra no lote e recebe `revoked_reason` igual a `logout_all`, porque expiração e revogação são colunas independentes e o que o registro conta é que o usuário mandou derrubar tudo.

A exclusão da sessão atual é opcional na assinatura da porta, e o adaptador traduz a ausência num argumento `undefined` dentro do `and()`, que o Drizzle ignora, de modo que a cláusula fica condicional sem precisar montar duas queries. A rota sempre passa a exclusão, porque preservar a sessão atual é a regra, e a opcionalidade fica na porta apenas como a forma de montar uma query só.

### Nenhuma migration foi necessária

A união `RevokedReason` ganhou `logout_all` ao lado de `user_logout`, e o banco não mudou. `revoked_reason` é `text` no Postgres, conforme a decisão tomada na etapa do logout, e a restrição de valores vive em `REVOKED_REASONS`, no TypeScript.

Esse é o retorno concreto daquela escolha. Com um `pgEnum`, acrescentar um motivo seria uma migration, e migration de enum é a operação que envelhece pior justamente enquanto a lista ainda cresce. Aqui a lista cresceu com uma linha de código, e o compilador continua sendo o único caminho até aquela coluna.

### O endpoint não pede a senha

Uma reautenticação antes de derrubar tudo parece prudente, e neste caso trabalha contra o objetivo. Quem aciona esta rota normalmente está reagindo a uma suspeita de acesso indevido, e a ação é a própria defesa: cada segundo entre a suspeita e a revogação é tempo que a sessão intrusa continua viva.

Além disso, quem já está autenticado passou pelo hook, então a identidade está provada na medida em que o resto do sistema exige. Pedir a senha de novo só adiciona atrito, e um atrito que também atrapalha quem esqueceu a senha e está justamente tentando se proteger.

O log registra o evento com `userId` e `revokedCount`, porque derrubar todos os dispositivos é sinal de segurança e não rotina. Nenhum token, email ou hash aparece nessa linha.

## Definition of done

* `DELETE /sessions` respondendo `204` sem corpo e sem declarar `body`, com o contrato publicado no OpenAPI
* Rota atrás do hook `authenticate`, respondendo `401` genérico quando o cookie está ausente, desconhecido, revogado ou expirado
* Requisição sem header de tipo e sem payload tratada como válida, porque a rota não lê corpo
* Demais sessões do usuário marcadas com `revoked_at` e `revoked_reason` igual a `logout_all`
* Sessão atual sempre intacta e cookie nunca limpo, com teste provando que nenhum `Set-Cookie` sai na resposta
* Sessões de outros usuários intactas, com teste provando o isolamento
* Usuário sem nenhuma outra sessão recebendo `204`, com contagem zero
* Segunda chamada seguida preservando o carimbo da primeira revogação
* Sessão expirada e ainda não revogada entrando no lote
* `request.user` e `request.session` disponíveis em rota protegida e nulos em rota que não usa o hook
* `pnpm test`, `pnpm typecheck`, `pnpm lint` e `pnpm build` verdes
