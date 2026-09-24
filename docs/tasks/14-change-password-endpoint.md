# 14. Change password endpoint

## Introdução

As etapas anteriores fecharam o ciclo de vida da sessão: entrar, sair deste dispositivo, sair de todos e revogar um escolhido. O que ainda faltava era agir sobre a credencial em si. Enxergar uma sessão estranha na lista de dispositivos conectados e derrubá-la resolve o sintoma, mas se a senha vazou, quem a tem volta a entrar no minuto seguinte com uma sessão nova. Trocar a senha é o que corta a origem do acesso, e por isso ela fecha a mesma história que a revogação começou.

Esta etapa entrega `POST /auth/change-password`, que substitui a senha do usuário autenticado depois de conferir a senha atual e, na mesma transação, encerra todas as outras sessões daquele usuário, apagando as linhas delas. A sessão que fez a requisição é preservada, então quem trocou a senha continua conectado no aparelho em que estava, enquanto todos os demais aparelhos caem. Um email avisa o dono da conta de que a troca aconteceu.

O endpoint nasce da tela de configurações da conta, onde o formulário pede a senha atual e a nova. É o mesmo par de campos que qualquer produto apresenta, e o contrato acompanha essa expectativa: dois campos no corpo, `204` sem corpo no sucesso e um `400` com mensagem própria para cada recusa possível.

## Requisitos técnicos

### Onde o código fica

A rota é `src/routes/auth/change-password.ts`, dentro da pasta cujo nome já é o prefixo, no mesmo desenho de `login.ts` e `signup.ts`. O service é `src/plugins/app/auth/change-password.ts` e chega à rota por `app.auth.changePassword`, montado em `create-auth.ts` ao lado de `signup`, `login`, `verifyCode`, `resendCode` e `authenticate`. O acesso ao banco são dois membros novos da porta `AuthRepository`, `findUserById` e `changePassword`, implementados tanto no adaptador Drizzle quanto no adaptador em memória dos testes. O aviso por email segue a divisão que o cadastro já tinha, com o template em `emails/password-changed.ts` e o envio em `send-password-changed.ts`.

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

Por isso as duas escritas formam um único método da porta, `changePassword`, e não duas chamadas orquestradas pelo service. A transação pertence ao adaptador que tem um banco, porque só ele sabe o que é uma transação, e o service continua sendo uma função que não conhece Postgres. É a mesma divisão que `verifyEmail` adotou para manter o autologin do cadastro atômico, e ela se paga de novo: o adaptador em memória dos testes implementa a mesma garantia sem precisar de transação nenhuma, porque um laço síncrono sobre arrays já é indivisível.

Para abrir a transação e reaproveitar o encerramento em lote que já existia, `createDrizzleAuthRepository` aceita `DatabaseOrTransaction`, o mesmo tipo que o adaptador de sessões já expunha. Dentro da transação, o repositório de sessões é construído sobre ela e `deleteUserSessions` roda ali, em vez de o `DELETE` ser reescrito numa segunda consulta.

O encerramento é filtrado por `user_id`, então as sessões de qualquer outro usuário permanecem intocadas, e um teste do adaptador em memória prova isso com dois usuários no mesmo store.

### A sessão atual sobrevive e o cookie nunca é tocado

`changePassword` recebe `exceptSessionId` com o id da sessão que está fazendo a requisição, vinda de `request.session.id`, e essa linha é a única do usuário que o encerramento preserva. A rota não chama `setCookie` nem `clearCookie`, e a resposta `204` não carrega nenhum `Set-Cookie`.

Derrubar também a sessão atual significaria deslogar quem acabou de fazer a coisa certa, obrigando a pessoa a entrar de novo imediatamente depois de digitar a senha nova, e o formulário de troca de senha se tornaria indistinguível de um erro. Não há ganho de segurança nisso: quem fez a operação provou posse da senha atual poucos milissegundos antes. Um teste faz a troca e em seguida chama `GET /me` com o mesmo cookie, provando que a sessão continua válida, e outro verifica que nenhuma outra sessão do usuário sobreviveu.

### O evento fica no log

As sessões encerradas pela troca somem da tabela como qualquer outra sessão encerrada, sem motivo gravado. O que conta depois que a senha mudou é a linha de log `password changed`, com o `userId`, escrita no caminho de sucesso. Nenhuma senha, hash ou email aparece nela.

### Toda recusa é um `400` com mensagem própria

As três recusas possíveis, senha atual incorreta, senha nova igual à atual e senha nova encontrada em vazamento, respondem `400`, cada uma com seu texto. Isso contrasta de propósito com o login, onde a resposta é deliberadamente genérica.

A diferença está em quem pergunta. No login, o chamador é anônimo e uma mensagem específica viraria oráculo para descobrir quais emails têm conta. Aqui, o chamador já está autenticado e só consegue falar sobre a própria conta, então não existe conta alheia a enumerar e a mensagem específica não revela nada que o dono da conta já não saiba. Uniformizar as três recusas tornaria a tela inútil, porque o usuário não teria como saber se deve corrigir a senha atual, escolher outra senha nova ou simplesmente digitar algo diferente do que já usa.

Nenhuma delas é `401`. A sessão é válida em todos esses casos, e foi a confirmação da senha que falhou. Um `401` diria ao frontend que a sessão acabou, o que na prática desloga o usuário por ter errado a senha atual num formulário. O `401` continua reservado para o que ele sempre significou neste projeto, a sessão ausente, desconhecida ou expirada, e vem do hook `authenticate` com a mensagem genérica de sempre.

O corpo é validado por `changePasswordBodySchema`, então uma senha nova fora da faixa de quinze a cento e vinte e oito caracteres também recebe `400`, antes de o service ser chamado.

### O aviso por email sai do caminho da requisição

`sendPasswordChanged` é disparado com `void` no fim do fluxo, e o resultado dele é descartado. A senha já está trocada quando o email sai, então deixar uma falha de entrega virar erro da requisição contaria ao usuário o oposto do que aconteceu, e ele tentaria de novo com uma senha atual que não é mais a atual. A função converte qualquer exceção em `false` e registra a falha no log, exatamente como o envio do módulo de código faz, de modo que o service nem precisa de um `try`.

O email não carrega link. O fluxo de recuperação de senha existe, e a linha final do aviso aponta para ele, mas como texto e não como link, porque um link dentro de um email sobre segurança ensina exatamente o hábito que o phishing explora. Quem não reconhece a troca é orientado a recuperar a senha a partir da tela de entrada.

Ele também não carrega horário nem nome do dispositivo. O rótulo de dispositivo vem do User-Agent, que é trivialmente forjável, e colocá-lo num aviso de segurança emprestaria a esse dado uma credibilidade que ele não tem, levando o leitor a descartar um aviso legítimo por não reconhecer a descrição. Sem nenhum desses valores, o template não recebe parâmetro algum, o que significa que nenhum dado fornecido pelo usuário chega até ele e não há nada a escapar. O log do envio registra apenas `userId` e o id da mensagem no provedor, nunca o endereço de destino nem o corpo da resposta do provedor, que pode ecoar o endereço.

## Definition of done

* `POST /auth/change-password` respondendo `204` sem corpo, com o contrato publicado no OpenAPI sob a tag `auth`
* Rota atrás do hook `authenticate`, respondendo o `401` genérico com `{ "message": "Unauthorized." }` quando o cookie está ausente, desconhecido ou expirado
* Corpo validado por `changePasswordBodySchema`, com a senha nova sob a mesma `passwordSchema` do cadastro e a senha atual apenas sob limite de comprimento
* `findUserById` e `changePassword` declarados em `AuthRepository`, implementados no adaptador Drizzle com as duas escritas numa transação e espelhados no adaptador em memória
* Service `changePassword` coberto por teste, incluindo a ordem das checagens, a recusa por senha atual incorreta quando a senha nova é igual a ela, a consulta ao verificador de vazamentos com a senha nova e a troca seguindo quando ele resolve `false`, o sucesso mesmo com o email falhando e o email não saindo em nenhuma das três recusas
* Teste do adaptador em memória provando que as sessões de outro usuário permanecem de pé e que a senha dele permanece intacta
* Teste de rota provando que a sessão atual continua servindo `GET /me` depois da troca, que a outra sessão foi apagada e que nenhum `Set-Cookie` sai na resposta
* Teste de rota provando um `400` com mensagem própria para cada recusa e que nenhum hash de senha aparece no corpo da resposta
* `pnpm typecheck`, `pnpm lint`, `pnpm test` e `pnpm build` verdes
