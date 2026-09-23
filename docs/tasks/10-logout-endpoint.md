# 10. Endpoint POST /auth/logout

## Introdução

O servidor já sabia criar sessão e já sabia ler sessão, mas não sabia encerrar sessão. Quem entrava ficava com um cookie válido por trinta dias e não tinha como devolvê-lo, o que deixava o fluxo incompleto justamente na ponta que o usuário aciona quando quer sair de um dispositivo emprestado, público ou simplesmente compartilhado.

Esta etapa entrega `POST /auth/logout`, que encerra a sessão do dispositivo que fez a requisição. O escopo é deliberadamente estrito, porque logout aqui significa uma coisa só, que é derrubar aquela sessão. Não existe corpo, não existe parâmetro e não existe a possibilidade de revogar a sessão de outro dispositivo, já que encerrar sessões de terceiros é outra funcionalidade, com outra tela e outras perguntas de segurança.

A promessa da sessão em banco, apresentada na etapa anterior, se paga aqui. Como a validade da sessão é verificada no banco a cada requisição, marcar a linha como revogada derruba o acesso imediatamente, sem prazo de carência e sem lista de tokens banidos. O logout de verdade sai de graça exatamente porque a sessão nunca foi um token autoassinado.

A rota também entrega uma propriedade que o cliente precisa poder assumir, que é a idempotência. Clicar em sair duas vezes, recarregar a página no meio da requisição ou mandar o pedido com um cookie já vencido produz sempre o mesmo resultado, ou seja, `204` e um cookie limpo.

## Requisitos técnicos

### A rota não exige autenticação

`POST /auth/logout` não usa o hook `authenticate`. Isso parece contraintuitivo, porque logout é uma ação de usuário logado, mas o hook responde a uma pergunta diferente da que esta rota faz. O hook pergunta "prove quem você é", e o logout diz "quero sair", que é um pedido que faz sentido mesmo quando o cookie está vencido, revogado ou corrompido.

Se o hook estivesse aplicado, um cookie ruim levaria a `401` e o usuário ficaria preso, com um cookie que não abre nada e que ele também não consegue mandar apagar. Pior, o próprio status viraria oráculo, porque o par `401` e `204` contaria a quem enviou um token qualquer se aquele token corresponde a uma sessão viva. Sem o hook, o único status possível é `204`, e a resposta não carrega informação nenhuma sobre o estado da sessão.

O handler lê o cookie cru de `request.cookies`, entrega ao service e segue adiante independentemente do que o banco encontrou. O service, por sua vez, devolve `void` em todos os caminhos, então nem ele sabe dizer se alguma linha foi marcada.

### A idempotência vive no `WHERE` do `UPDATE`

O repositório ganhou `revokeSessionByTokenHash`, cujo `UPDATE` filtra por `token_hash = ?` combinado com `revoked_at IS NULL`. É desse `WHERE` que a idempotência sai. Uma sessão inexistente, uma sessão já revogada ou um token desconhecido simplesmente não casam nenhuma linha, e o comando termina sem efeito e sem erro.

A alternativa seria ler a sessão, decidir em TypeScript se ela ainda vale e escrever em seguida. Ela custaria uma ida a mais ao banco e, principalmente, abriria uma janela entre a leitura e a escrita, em que duas requisições simultâneas poderiam ambas achar a sessão viva e a segunda sobrescrever o carimbo da primeira. Com a guarda no `WHERE`, o banco resolve a corrida sozinho, e o primeiro logout é o que fica registrado.

Essa é a única regra de sessão que mora no SQL neste projeto, o que contraria o critério adotado na etapa anterior, e o motivo é que aqui o `WHERE` não decide se o acesso é permitido, ele apenas garante que uma escrita não sobrescreva a outra. A regra que não pode ficar sem teste é a de autorização, e essa continua inteira em TypeScript.

O `WHERE` não filtra por `expires_at`, de propósito. Uma sessão vencida mas nunca revogada é marcada assim mesmo, porque o que o registro conta é que o usuário saiu daquele dispositivo, e esse fato aconteceu independentemente de a sessão já ter vencido sozinha antes.

### O motivo da revogação é união de TypeScript, não enum de banco

A coluna `revoked_reason` continua `text` no Postgres, e a restrição de valores vive na aplicação, em `REVOKED_REASONS`, exportado de `src/lib/session.ts`. A constante nasce com um valor só, `user_logout`, e cada fluxo irmão acrescenta o seu quando chegar, seja a troca de senha que derruba as outras sessões, seja a revogação administrativa.

Um enum de banco tornaria cada valor novo uma migration, e migration de enum em Postgres é justamente a operação que envelhece mal quando a lista ainda está crescendo. A união de TypeScript entrega a mesma proteção onde ela importa, que é em tempo de compilação, no momento em que alguém escreve a chamada. O banco nunca recebe um valor que não passou pelo compilador, porque o único caminho até aquela coluna é o repositório, e ele exige o tipo.

Vale notar que expiração não é motivo de revogação e por isso não escreve nessa coluna. Ela vive em `expires_at` e é conferida por conta própria, então misturar as duas coisas faria a coluna significar duas coisas diferentes.

### A limpeza do cookie leva as opções inteiras

O `clearCookie` recebe `SESSION_COOKIE.options` completo, e não apenas o `path`. O motivo é que um cabeçalho de deleção é, para o navegador, um `Set-Cookie` comum com validade no passado, e ele só substitui o cookie existente quando os atributos batem. Sem `Secure`, o navegador vê um cookie não seguro tentando sobrescrever um seguro, e parte deles trata os dois como entradas distintas, de modo que o cookie original sobreviveria ao logout.

Mandar as opções inteiras não vaza o prazo de trinta dias, porque o `clearCookie` do `@fastify/cookie` sobrescreve `maxAge` para zero e `expires` para a época antes de serializar. O resultado é um cabeçalho com os mesmos atributos do cookie original e validade vencida, que é exatamente o que apaga a entrada.

O cookie `signup_session` não é tocado. Ele já é limpo pela confirmação do código, e quem está no meio do cadastro não tem sessão para derrubar.

### O token cru nunca chega ao repositório

O service hasheia o token com `hashSessionToken` antes de chamar o repositório, da mesma forma que o hook de autenticação faz. O banco guarda apenas o SHA-256, então o hash é a única forma de encontrar a linha, e há teste garantindo que a chamada ao repositório não recebe o valor cru, para que uma troca descuidada no futuro não passe silenciosa.

Antes de hashear, o service devolve cedo quando o token é ausente ou string vazia. O cookie pode chegar como `""`, e sem essa guarda o servidor faria uma escrita no banco com o hash de uma string vazia, que nunca casa nada e só serve para gastar conexão em requisição anônima.

### Sem log

O logout não escreve nada no log. Sair de um dispositivo é rotina, não sinal de segurança, e qualquer linha realmente útil precisaria carregar identificador de usuário ou de sessão, que é exatamente o tipo de dado que não entra em log neste projeto.

## Definition of done

* `POST /auth/logout` respondendo `204` sem corpo, com o contrato publicado no OpenAPI
* A rota funcionando sem o hook `authenticate`, respondendo `204` também quando não há cookie de sessão
* Sessão do cookie marcada com `revoked_at` e `revoked_reason` igual a `user_logout`
* Demais sessões do mesmo usuário intactas, com teste provando o isolamento
* Segundo logout com o mesmo token preservando o carimbo da primeira revogação
* Token desconhecido, cookie vazio e sessão já revogada respondendo `204` sem tocar o banco indevidamente
* Cookie de sessão limpo com `Max-Age=0` e com `HttpOnly`, `Secure`, `SameSite=Strict` e `Path=/`
* Teste garantindo que o repositório recebe o hash do token, nunca o token
* `pnpm test`, `pnpm typecheck`, `pnpm lint` e `pnpm build` verdes
