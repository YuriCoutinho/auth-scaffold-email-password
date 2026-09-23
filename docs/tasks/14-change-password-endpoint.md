# 14. Change password endpoint

## Introdução

As etapas anteriores fecharam o ciclo de vida da sessão: entrar, sair deste dispositivo, sair de todos e revogar um escolhido. O que ainda faltava era agir sobre a credencial em si. Enxergar uma sessão estranha na lista de dispositivos conectados e derrubá-la resolve o sintoma, mas se a senha vazou, quem a tem volta a entrar no minuto seguinte com uma sessão nova. Trocar a senha é o que corta a origem do acesso, e por isso ela fecha a mesma história que a revogação começou.

Esta etapa entrega `POST /auth/change-password`, que substitui a senha do usuário autenticado depois de conferir a senha atual e, na mesma transação, revoga todas as outras sessões daquele usuário. A sessão que fez a requisição é preservada, então quem trocou a senha continua conectado no aparelho em que estava, enquanto todos os demais aparelhos caem. Um email avisa o dono da conta de que a troca aconteceu.

O endpoint nasce da tela de configurações da conta, onde o formulário pede a senha atual e a nova. É o mesmo par de campos que qualquer produto apresenta, e o contrato acompanha essa expectativa: dois campos no corpo, `204` sem corpo no sucesso e um `400` com mensagem própria para cada recusa possível.

## Requisitos técnicos

### Onde o código fica

A rota é `src/routes/auth/change-password.ts`, dentro da pasta cujo nome já é o prefixo, no mesmo desenho de `login.ts` e `signup.ts`. O service é `src/plugins/app/auth/change-password.ts` e chega à rota por `app.auth.changePassword`, montado em `create-auth.ts` ao lado de `signup`, `login`, `verifyCode`, `resendCode` e `authenticate`. O acesso ao banco são dois membros novos da porta `AuthRepository`, `findAuthUserCredentialsById` e `changeUserPassword`, implementados tanto no adaptador Drizzle quanto no adaptador em memória dos testes. O aviso por email segue a divisão que o cadastro já tinha, com o template em `emails/password-changed.ts` e a mensagem renderizada entregue ao repositório, que a enfileira no outbox junto das demais escritas.

### A senha atual é exigida mesmo com a sessão já autenticada

O usuário já provou quem é para chegar até aqui, e ainda assim precisa digitar a senha atual. A exigência não é sobre identidade, é sobre posse recente da credencial. O cookie de sessão sobrevive por dias e acompanha o navegador aberto num computador compartilhado, então autenticado não quer dizer presente. Sem a confirmação, qualquer pessoa que sente na cadeira de um usuário logado, ou qualquer atacante que tenha capturado o cookie, troca a senha, fica com a única sessão viva por causa da revogação em lote e expulsa o dono da própria conta.

Pedir a senha atual transforma a troca num ato que exige conhecer o segredo, e não apenas segurar o cookie. É também o que dá sentido à revogação das demais sessões, porque quem passou pela confirmação é quem tem direito de decidir que todo o resto cai.

O campo da senha atual é validado apenas por comprimento, entre um e cento e vinte e oito caracteres, e não pela regra de força que a senha nova precisa cumprir. Aplicar a regra de força a um valor que só vai ser comparado com um hash guardado travaria justamente quem cadastrou a senha antes de a regra existir, ou seja, exatamente quem mais precisa trocá-la. A regra de força mora em `passwordSchema`, exportada de `src/schemas/auth.ts` e usada tanto pelo corpo do cadastro quanto pelo da troca, para que as duas não divirjam com o tempo.

### A senha atual é conferida antes da consulta ao Have I Been Pwned

No cadastro, a consulta à base de vazamentos acontece antes de qualquer outra coisa, porque ali não existe segredo nenhum para provar e a única informação disponível é a própria senha proposta. Aqui existe, e a ordem se inverte de propósito: primeiro o argon2 confere a senha atual, depois vem a comparação com a nova, e só então a chamada externa.

A consulta ao Have I Been Pwned é uma requisição de saída, com custo de latência e de quota, disparada por um input que o chamador controla inteiramente. Deixá-la na frente daria a quem roubou um cookie a capacidade de gerar tráfego externo ilimitado em nome do serviço, sem nunca precisar acertar a senha. Colocando a prova de posse antes, quem não conhece a senha atual para no primeiro passo e não move nada além de uma verificação de hash local.

O verificador de vazamentos falha aberto por desenho: um timeout ou um erro da API resolve `false`, e a troca segue adiante. É a mesma decisão que o cadastro tomou, pelo mesmo motivo, porque uma base externa indisponível não pode virar uma conta impedida de melhorar a própria senha. Falhar aberto é comportamento do verificador, e são os testes dele que fixam os dois casos que caem nessa saída, a requisição que rejeita e a resposta fora da faixa 2xx, ambos resolvendo `false`. O timeout chega ao mesmo tratamento, porque `AbortSignal.timeout` rejeita a requisição. O service não conhece nem repete essa regra, então o que os testes dele fixam é o outro lado do contrato, que o verificador é consultado com a senha nova e que um `false` não impede a troca.

### A senha nova não pode ser igual à atual

Uma troca que devolve o mesmo valor não é troca, e aceitar isso seria pior do que inútil. Quem está trocando a senha quase sempre chegou aqui por suspeita de vazamento, e sair da tela com uma confirmação de sucesso, tendo mantido exatamente a credencial comprometida, é entregar uma falsa sensação de resolução. Além disso, a operação revogaria todas as outras sessões e mandaria o email de aviso, gastando o efeito colateral inteiro sem nenhum ganho.

A comparação é feita entre os dois valores em claro que chegaram na mesma requisição, não entre hashes, o que a torna trivial e dispensa qualquer verificação extra de argon2.

A ordem entre essa checagem e a conferência da senha atual importa. Quando a senha atual está errada e a nova é igual a ela, a resposta é sempre a de senha atual incorreta, nunca a de senha repetida. Responder que as senhas são iguais nesse caso contaria ao atacante que o palpite dele bate com a senha guardada, transformando a mensagem de erro num verificador de senha. Como a conferência vem primeiro e retorna ali mesmo, o caso nem chega à comparação. Um teste fixa exatamente esse cenário.

### A gravação da senha e a revogação são uma transação só, dentro do repositório

Trocar a senha e derrubar as outras sessões são duas escritas que precisam valer juntas. Se a senha nova é gravada e a revogação falha, o sistema fica no estado exato que este endpoint existe para impedir, com sessões antigas vivas sob uma credencial que o usuário acredita ter substituído. Se a ordem se inverte e a gravação falha, as sessões caem sem motivo e a senha antiga continua valendo.

Por isso as duas escritas formam um único método da porta, `changeUserPassword`, e não duas chamadas orquestradas pelo service. A transação pertence ao adaptador que tem um banco, porque só ele sabe o que é uma transação, e o service continua sendo uma função que não conhece Postgres. É a mesma divisão que `promotePendingSignup` adotou para manter o autologin do cadastro atômico, e ela se paga de novo: o adaptador em memória dos testes implementa a mesma garantia sem precisar de transação nenhuma, porque um laço síncrono sobre arrays já é indivisível.

Para abrir a transação e reaproveitar a revogação em lote que já existia, `createDrizzleAuthRepository` passa a aceitar `DatabaseOrTransaction`, o mesmo tipo que o adaptador de sessões já expunha. Dentro da transação, o repositório de sessões é construído sobre ela e `revokeAllUserSessions` roda ali, em vez de a lógica de revogação ser reescrita numa segunda consulta.

A revogação é filtrada por `user_id`, então as sessões de qualquer outro usuário permanecem intocadas, e um teste do adaptador em memória prova isso com dois usuários no mesmo store.

### A sessão atual sobrevive e o cookie nunca é tocado

`changeUserPassword` recebe `exceptSessionId` com o id da sessão que está fazendo a requisição, vinda de `request.session.id`, e essa linha é a única do usuário que a revogação preserva. A rota não chama `setCookie` nem `clearCookie`, e a resposta `204` não carrega nenhum `Set-Cookie`.

Derrubar também a sessão atual significaria deslogar quem acabou de fazer a coisa certa, obrigando a pessoa a entrar de novo imediatamente depois de digitar a senha nova, e o formulário de troca de senha se tornaria indistinguível de um erro. Não há ganho de segurança nisso: quem fez a operação provou posse da senha atual poucos milissegundos antes. Um teste faz a troca e em seguida chama `GET /me` com o mesmo cookie, provando que a sessão continua válida, e outro verifica que nenhuma outra sessão do usuário sobreviveu.

### O motivo da revogação é `password_changed`, e ele não exige migration

`REVOKED_REASONS` ganha `password_changed` ao lado de `user_logout`, `logout_all` e `session_revoked`. Os motivos existentes nomeiam eventos concretos, não categorias, e o novo segue a mesma lógica: a linha de sessão passa a contar por que terminou, e um motivo genérico como `security_event` apagaria justamente a informação que faz esse campo valer a pena numa investigação posterior.

A coluna `revoked_reason` é um `text` simples, sem CHECK e sem enum de banco, então acrescentar um valor é acrescentar um membro do array `as const` e nada mais. A restrição vive no TypeScript, onde `RevokedReason` é derivado do array, e é ele que impede um valor inventado de chegar ao repositório. O teste que fixa a lista inteira garante que o conjunto permaneça explícito.

### Toda recusa é um `400` com mensagem própria

As três recusas possíveis, senha atual incorreta, senha nova igual à atual e senha nova encontrada em vazamento, respondem `400`, cada uma com seu texto. Isso contrasta de propósito com o login, onde a resposta é deliberadamente genérica.

A diferença está em quem pergunta. No login, o chamador é anônimo e uma mensagem específica viraria oráculo para descobrir quais emails têm conta. Aqui, o chamador já está autenticado e só consegue falar sobre a própria conta, então não existe conta alheia a enumerar e a mensagem específica não revela nada que o dono da conta já não saiba. Uniformizar as três recusas tornaria a tela inútil, porque o usuário não teria como saber se deve corrigir a senha atual, escolher outra senha nova ou simplesmente digitar algo diferente do que já usa.

Nenhuma delas é `401`. A sessão é válida em todos esses casos, e foi a confirmação da senha que falhou. Um `401` diria ao frontend que a sessão acabou, o que na prática desloga o usuário por ter errado a senha atual num formulário. O `401` continua reservado para o que ele sempre significou neste projeto, a sessão ausente, desconhecida, revogada ou expirada, e vem do hook `authenticate` com a mensagem genérica de sempre.

O corpo é validado por `changePasswordBodySchema`, então uma senha nova fora da faixa de quinze a cento e vinte e oito caracteres também recebe `400`, antes de o service ser chamado.

### O aviso por email é enfileirado junto da troca e nunca muda a resposta

O service renderiza o template e passa a mensagem para `changeUserPassword`, que a grava na mesma transação da nova senha e da revogação. A requisição não fala com o provedor, então uma indisponibilidade dele não tem como virar erro de uma operação que já aconteceu, e o usuário não recebe um erro que o levaria a tentar de novo com uma senha atual que não é mais a atual. Ficar na mesma transação também garante o outro lado: um aviso sobre uma troca que sofreu rollback nunca chega a existir. Quem entrega a mensagem, com repetições, é o worker descrito na etapa 15.

O email não carrega link. O fluxo de recuperação de senha ainda não existe, então um botão de "não fui eu" não teria para onde apontar, e um link que não resolve o problema só ensina o usuário a clicar em links dentro de emails sobre segurança, que é o hábito que o phishing explora. O texto orienta a procurar o suporte.

Ele também não carrega horário nem nome do dispositivo. O rótulo de dispositivo vem do User-Agent, que é trivialmente forjável, e colocá-lo num aviso de segurança emprestaria a esse dado uma credibilidade que ele não tem, levando o leitor a descartar um aviso legítimo por não reconhecer a descrição. Sem nenhum desses valores, o template não recebe parâmetro algum, o que significa que nenhum dado fornecido pelo usuário chega até ele e não há nada a escapar. O log registra apenas `userId` na troca e, na entrega, o identificador da linha do outbox e o tipo da mensagem, nunca o endereço de destino nem o corpo da resposta do provedor, que pode ecoar o endereço.

## Definition of done

* `POST /auth/change-password` respondendo `204` sem corpo, com o contrato publicado no OpenAPI sob a tag `auth`
* Rota atrás do hook `authenticate`, respondendo o `401` genérico com `{ "message": "Unauthorized." }` quando o cookie está ausente, desconhecido, revogado ou expirado
* Corpo validado por `changePasswordBodySchema`, com a senha nova sob a mesma `passwordSchema` do cadastro e a senha atual apenas sob limite de comprimento
* `findAuthUserCredentialsById` e `changeUserPassword` declarados em `AuthRepository`, implementados no adaptador Drizzle com a nova senha, a revogação e o email enfileirado numa transação só, e espelhados no adaptador em memória
* `password_changed` acrescentado a `REVOKED_REASONS` e gravado em `revoked_reason` nas sessões revogadas, sem migration
* Service `changePassword` coberto por teste, incluindo a ordem das checagens, a recusa por senha atual incorreta quando a senha nova é igual a ela, a consulta ao verificador de vazamentos com a senha nova e a troca seguindo quando ele resolve `false`, o aviso enfileirado na mesma escrita da troca e nada enfileirado em nenhuma das três recusas
* Teste do adaptador em memória provando que as sessões de outro usuário permanecem ativas e que a senha dele permanece intacta
* Teste de rota provando que a sessão atual continua servindo `GET /me` depois da troca, que a outra sessão foi revogada com o motivo correto e que nenhum `Set-Cookie` sai na resposta
* Teste de rota provando um `400` com mensagem própria para cada recusa e que nenhum hash de senha aparece no corpo da resposta
* `pnpm typecheck`, `pnpm lint`, `pnpm test` e `pnpm build` verdes
