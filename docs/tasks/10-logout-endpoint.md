# 10. Endpoint DELETE /sessions/current

## Introdução

O servidor já sabia criar sessão e já sabia ler sessão, mas não sabia encerrar sessão. Quem entrava ficava com um cookie válido por trinta dias e não tinha como devolvê-lo, o que deixava o fluxo incompleto justamente na ponta que o usuário aciona quando quer sair de um dispositivo emprestado, público ou simplesmente compartilhado.

Esta etapa entrega `DELETE /sessions/current`, que encerra a sessão do dispositivo que fez a requisição. O escopo é deliberadamente estrito, porque logout aqui significa uma coisa só, que é derrubar aquela sessão. Não existe corpo, não existe parâmetro e não existe a possibilidade de revogar a sessão de outro dispositivo, já que encerrar sessões de terceiros é outra funcionalidade, com outra tela e outras perguntas de segurança.

A promessa da sessão em banco, apresentada na etapa anterior, se paga aqui. Como a validade da sessão é verificada no banco a cada requisição, apagar a linha derruba o acesso imediatamente, sem prazo de carência e sem lista de tokens banidos. O logout de verdade sai de graça exatamente porque a sessão nunca foi um token autoassinado.

A rota também entrega uma propriedade que o cliente precisa poder assumir, que é a idempotência. Clicar em sair duas vezes, recarregar a página no meio da requisição ou mandar o pedido com um cookie já vencido produz sempre o mesmo resultado, ou seja, `204` e um cookie limpo.

## Requisitos técnicos

### A sessão é uma fatia própria, com porta, adaptador e decorator

A porta `SessionRepository` já existia desde a modelagem, porque login e confirmação de cadastro precisam gravar sessão e o hook precisa lê-la, mas até aqui ela era só isso, uma porta de gravar e buscar. Encerrar sessão é a primeira operação que trata a sessão como coisa em si, e não como subproduto de autenticar alguém, então é aqui que a fatia `src/plugins/app/sessions/` se completa. `repository.ts` declara a porta, `drizzle-repository.ts` é o adaptador dela, os services vivem ao lado, `create-sessions.ts` os monta e `index.ts` decora a instância como `fastify.sessions`. As rotas que falam de sessão ficam juntas em `src/routes/sessions/`, e esta é `current.ts`.

A fronteira com `auth` é de mão única. A fatia de identidade pode pedir alguma coisa à de sessão, como o login pedindo `createSession` e a confirmação do cadastro pedindo a inserção dentro da própria transação, e o contrário nunca acontece: nenhum arquivo de `sessions/` importa de `auth/`. Essa direção é o que permite ler a fatia de sessão inteira sem precisar entender cadastro, código de confirmação nem senha, e é ela que mantém `SessionRepository` enxuta em vez de virar um segundo `AuthRepository`.

O service `authenticate` é a única exceção aparente, e ele fica em `auth` de propósito. Ele lê pela porta de sessão, mas a pergunta que responde é "quem é você", que é identidade, e não gestão de sessão.

### O caminho é `DELETE /sessions/current`

O endereço nomeia o recurso e deixa o verbo HTTP dizer o que acontece com ele. A sessão do request é um recurso identificável, `current` é o apelido dela dentro da coleção, e apagá-la é `DELETE`. O par `POST /auth/logout` diria a mesma coisa com um verbo de fluxo colado num prefixo de credencial, e sessão não é credencial, é recurso do usuário autenticado.

A consequência prática é que as três operações de sessão ficam no mesmo lugar e se leem em conjunto: `GET /sessions` lista, `DELETE /sessions/current` derruba esta, e `DELETE /sessions` derruba as outras. Quem abre o Swagger vê a coleção inteira de uma vez, em vez de caçar metade dela sob `/auth`.

### A rota não exige autenticação

`DELETE /sessions/current` não usa o hook `authenticate`. Isso parece contraintuitivo, porque logout é uma ação de usuário logado, mas o hook responde a uma pergunta diferente da que esta rota faz. O hook pergunta "prove quem você é", e o logout diz "quero sair", que é um pedido que faz sentido mesmo quando o cookie está vencido, já encerrado ou corrompido.

Se o hook estivesse aplicado, um cookie ruim levaria a `401` e o usuário ficaria preso, com um cookie que não abre nada e que ele também não consegue mandar apagar. Pior, o próprio status viraria oráculo, porque o par `401` e `204` contaria a quem enviou um token qualquer se aquele token corresponde a uma sessão viva. Sem o hook, o único status possível é `204`, e a resposta não carrega informação nenhuma sobre o estado da sessão.

O handler lê o cookie cru de `request.cookies`, entrega ao service e segue adiante independentemente do que o banco encontrou. O service, por sua vez, devolve `void` em todos os caminhos, então nem ele sabe dizer se alguma linha foi apagada.

### Encerrar é apagar a linha

A porta `SessionRepository` ganhou `deleteSessionByTokenHash`, cujo `DELETE` no adaptador Drizzle filtra por `token_hash = ?`. A idempotência sai da própria natureza do `DELETE`: uma sessão inexistente, uma sessão já encerrada ou um token desconhecido simplesmente não casam nenhuma linha, e o comando termina sem efeito e sem erro. Duas requisições simultâneas também não disputam nada, porque apagar duas vezes a mesma linha tem o mesmo resultado que apagar uma.

A alternativa seria marcar a linha com um instante e um motivo de revogação em vez de apagá-la. Ela foi descartada porque transforma a tabela de sessões num histórico que cresce sem parar, com colunas que nenhum fluxo lê e um filtro de "ainda não revogada" que toda consulta precisa lembrar. A tabela guarda só sessões vivas, e a pergunta "o que aconteceu com esta sessão" pertence aos logs estruturados, não à tabela de negócio.

O `DELETE` não filtra pela validade, de propósito. Uma sessão vencida é apagada do mesmo jeito, o que é inofensivo, porque ela já não abria nada, e só adianta o trabalho da limpeza periódica.

### A limpeza do cookie leva as opções inteiras

O `clearCookie` recebe as opções completas do cookie de sessão, vindas de `cookiePolicy`, e não apenas o `path`. O motivo é que um cabeçalho de deleção é, para o navegador, um `Set-Cookie` comum com validade no passado, e ele só substitui o cookie existente quando os atributos batem. Sem `Secure`, o navegador vê um cookie não seguro tentando sobrescrever um seguro, e parte deles trata os dois como entradas distintas, de modo que o cookie original sobreviveria ao logout.

Mandar as opções inteiras não vaza o tempo de vida da sessão, porque o `clearCookie` do `@fastify/cookie` sobrescreve `maxAge` para zero e `expires` para a época antes de serializar. O resultado é um cabeçalho com os mesmos atributos do cookie original e validade vencida, que é exatamente o que apaga a entrada.

O cookie `signup_session` não é tocado. Ele já é limpo pela confirmação do código, e quem está no meio do cadastro não tem sessão para derrubar.

### O token cru nunca chega ao repositório

O service hasheia o token com `hashSessionToken` antes de chamar o repositório, da mesma forma que o hook de autenticação faz. O banco guarda apenas o SHA-256, então o hash é a única forma de encontrar a linha, e há teste garantindo que a chamada ao repositório não recebe o valor cru, para que uma troca descuidada no futuro não passe silenciosa.

Antes de hashear, o service devolve cedo quando o token é ausente ou string vazia. O cookie pode chegar como `""`, e sem essa guarda o servidor faria um `DELETE` no banco com o hash de uma string vazia, que nunca casa nada e só serve para gastar conexão em requisição anônima.

### Sem log

O logout não escreve nada no log. Sair de um dispositivo é rotina, não sinal de segurança, e qualquer linha realmente útil precisaria carregar identificador de usuário ou de sessão, que é exatamente o tipo de dado que não entra em log neste projeto.

## Definition of done

* `DELETE /sessions/current` respondendo `204` sem corpo, com o contrato publicado no OpenAPI
* A rota funcionando sem o hook `authenticate`, respondendo `204` também quando não há cookie de sessão
* Linha da sessão do cookie apagada
* Demais sessões do mesmo usuário intactas, com teste provando o isolamento
* Segundo logout com o mesmo token respondendo `204` sem efeito
* Token desconhecido, cookie vazio e sessão já encerrada respondendo `204` sem tocar o banco indevidamente
* Cookie de sessão limpo com `Max-Age=0` e com `HttpOnly`, `Secure`, `SameSite=Strict` e `Path=/`
* Teste garantindo que o repositório recebe o hash do token, nunca o token
* Fatia `src/plugins/app/sessions/` com a porta `SessionRepository`, o adaptador Drizzle e o decorator `fastify.sessions`, sem nenhum import de `src/plugins/app/auth/`
* Rota em `src/routes/sessions/current.ts`, dentro da coleção que o prefixo da pasta define
* `pnpm test`, `pnpm typecheck`, `pnpm lint` e `pnpm build` verdes
