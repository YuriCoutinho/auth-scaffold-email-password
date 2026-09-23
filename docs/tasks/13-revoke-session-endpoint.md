# 13. Revoke session endpoint

## Introdução

A etapa anterior entregou a lista de sessões ativas, que é a tela de dispositivos conectados vista pelo lado do servidor. Olhar para a lista e reconhecer uma sessão que não deveria estar ali só tem valor se existir o botão ao lado dela, e é esse botão que falta. Sem ele, quem enxerga um acesso estranho num computador emprestado continua com a opção nuclear como única saída, derrubando junto tudo o que estava funcionando.

Esta etapa entrega `DELETE /sessions/:sessionId`, que revoga uma sessão do usuário autenticado identificada pelo id público que a listagem devolve. Com ela, a coleção `/sessions` fecha o trio de revogação: `DELETE /sessions/current` derruba o dispositivo atual, `DELETE /sessions` derruba os demais de uma vez, e `DELETE /sessions/:sessionId` derruba exatamente um, escolhido pelo usuário.

O endpoint nasce da tela de dispositivos conectados e assume o contrato que ela já tem em mãos. Cada linha da listagem traz um `id`, que é o `public_id` da sessão, então revogar é devolver ao servidor o mesmo identificador que ele acabou de entregar, sem que o frontend precise conhecer nada sobre como aquela sessão é guardada.

## Requisitos técnicos

### Onde o código fica

A rota é `src/routes/sessions/revoke.ts`, registrando `DELETE /:sessionId` dentro da pasta cujo nome já é o prefixo, no mesmo desenho de `list.ts`, `current.ts` e `all.ts`. O service é `src/plugins/app/sessions/revoke-session.ts` e chega à rota por `app.sessions.revokeSession`, montado em `create-sessions.ts` ao lado de `logout`, `logoutAll` e `listSessions`. O acesso ao banco é `revokeUserSessionByPublicId`, declarado na porta `SessionRepository` e implementado tanto no adaptador Drizzle quanto no adaptador em memória dos testes. Nada em `sessions/` importa de `auth/`, porque sessão e identidade continuam se encontrando no request e não nos módulos.

### O identificador é o `public_id`, nunca o serial

O caminho da rota recebe o uuid que `GET /sessions` devolve, e a chave primária de `sessions` segue sem aparecer. Um id sequencial num caminho público é enumerável, convida a tentar vizinhos e, pior que isso, conta o volume: quem conhece dois ids sabe quantas sessões o sistema emitiu entre eles. Essa é a mesma razão que levou a etapa anterior a criar o `public_id`, e aqui ela se paga, porque o identificador que já era seguro de mostrar é também seguro de receber de volta.

Nenhuma migration foi necessária. A coluna `public_id` existe desde a listagem, com `NOT NULL` e `UNIQUE`, e no Postgres uma restrição de unicidade já é um índice B-tree, então a busca pelo uuid chega pronta e indexada.

### A resposta é sempre `204`, tenha revogado ou não

A rota responde `204` sem corpo quando a sessão foi revogada, quando o uuid não existe, quando pertence a outro usuário, quando já estava revogada e quando já havia expirado. Qualquer diferença entre esses casos, seja um `404`, um corpo ou um header a mais, transformaria o endpoint num oráculo: bastaria varrer uuids e ler o status para descobrir quais sessões existem e de quem são. Como uuid v4 não é adivinhável, essa varredura é impraticável, e a resposta uniforme garante que ela também seja inútil.

É a mesma escolha que `DELETE /sessions/current` já tinha feito por um motivo parecido, e o efeito colateral é bom para o cliente: revogar duas vezes a mesma sessão, porque alguém clicou duas vezes ou porque a tela estava desatualizada, é indistinguível de revogar uma vez.

### Identificação e autorização viajam no mesmo `WHERE`

`revokeUserSessionByPublicId` faz um único `UPDATE` cujo `WHERE` carrega quatro condições ao mesmo tempo: `public_id` igual ao do caminho, `user_id` igual ao do usuário autenticado, `revoked_at IS NULL` e `expires_at` maior que o instante atual. Não há leitura antes da escrita.

Juntar identificação e autorização na mesma cláusula é o que torna impossível revogar sessão alheia, mesmo que o service esqueça uma verificação ou que uma refatoração futura reordene o fluxo. Uma sessão de outro dono simplesmente não casa linha nenhuma. Separar isso em "ler a sessão, conferir o dono, então escrever" daria o mesmo resultado no caminho feliz e abriria uma janela entre a conferência e a gravação, além de deixar a regra dependente de uma linha que alguém pode remover sem que teste nenhum de leitura acuse.

A guarda `revoked_at IS NULL` é a mesma das revogações anteriores e entrega a idempotência: a segunda chamada casa zero linhas, então o carimbo da primeira revogação permanece intacto em vez de ser sobrescrito pela data mais recente.

A condição de expiração existe para manter uma definição só. Uma sessão vencida e nunca revogada não aparece em `GET /sessions` e não autentica requisição nenhuma, então ela já está morta e não recebe `revoked_at`, porque marcar um motivo de revogação ali contaria uma história falsa sobre como aquela sessão terminou. Assim "revogável por esta rota" e "listado como ativo" são exatamente o mesmo conjunto, e a tela nunca oferece um botão que não corresponde a nada. A revogação em lote de `DELETE /sessions` segue sendo a exceção deliberada, porque ali o registro conta que o usuário mandou derrubar tudo.

### Não existe caso especial para a sessão atual

Se o uuid enviado for o da própria sessão que está fazendo a requisição, ela é revogada como qualquer outra. A rota não compara o alvo com `request.session.id`, não limpa o cookie e não ramifica a resposta.

Quem separa "este dispositivo" dos demais é a tela, pelo `isCurrent` que a listagem devolve justamente para isso. Trazer essa distinção para o servidor significaria ou recusar a operação, inventando um erro que nada pede, ou duplicar aqui o comportamento de cookie que pertence a `DELETE /sessions/current`. A rota faz uma coisa só, e sair do dispositivo atual continua tendo um endereço próprio, que sabe limpar o cookie porque essa sempre foi a responsabilidade dele.

Como consequência, o cookie nunca é tocado por esta rota, e um teste prova que nenhum `Set-Cookie` sai na resposta.

### O id malformado recebe `400`, e isso não vaza nada

O caminho é validado com `sessionParamsSchema`, que é `z.object({ sessionId: z.uuid() })`, em `src/schemas/sessions.ts`. Um `:sessionId` que não é uuid recebe `400` sem que nenhuma consulta pela sessão alvo aconteça. A validação do Zod roda depois do hook `authenticate`, que é `onRequest` e já consultou o banco pelo hash do cookie para provar quem está chamando, então o que o `400` garante não é que o banco ficou intocado, e sim que o identificador do caminho nunca foi procurado nele.

Isso parece contradizer a resposta uniforme, e não contradiz, porque as duas perguntas são diferentes. O `204` esconde se um identificador bem formado corresponde a alguma sessão, que é informação sobre dados. O `400` diz que a requisição não é sequer uma pergunta válida, que é informação sobre a forma da string, e a mesma string recebe a mesma recusa em qualquer instalação do projeto, independentemente do que exista no banco. É por isso que ele não vira oráculo. Engolir esse caso com um `204` faria um bug de cliente, como enviar `undefined` no lugar do id, passar despercebido para sempre.

A validação também é o que garante que `DELETE /sessions/current` e `DELETE /sessions/:sessionId` não colidam. O Fastify casa rota estática antes de paramétrica, então `current` chega sempre ao seu próprio handler, e ainda que a ordem mudasse, a string `current` nunca seria aceita como uuid.

### O service resolve `void` e o log é detalhado

`revokeSession` recebe `{ userId, publicId }`, chama o repositório e resolve `void`, mesmo o repositório informando se alguma linha foi revogada. Devolver o booleano até a rota não teria consumidor e só convidaria alguém a ramificar a resposta em algum momento, que é exatamente o oráculo que esta etapa evita. O tipo fecha a porta antes de ela existir.

A informação não se perde, ela muda de destino. Quando houve revogação de fato, o service escreve uma linha de log com `userId` e `sessionPublicId`, e é justamente por nunca sair do servidor que essa linha pode ser específica enquanto a resposta permanece genérica. Quando nada foi revogado, nenhuma linha é escrita, porque uma chamada que não mudou o estado não é evento. Nenhum token, hash de token ou email aparece no log.

## Definition of done

* `DELETE /sessions/:sessionId` respondendo `204` sem corpo, com o contrato publicado no OpenAPI sob a tag `sessions`
* `:sessionId` validado como uuid por schema Zod, respondendo `400` sem que a sessão alvo chegue a ser procurada no banco, com o contrato do erro declarado na rota
* Rota atrás do hook `authenticate`, respondendo o `401` genérico com `{ "message": "Unauthorized." }` quando o cookie está ausente, desconhecido, revogado ou expirado
* `revokeUserSessionByPublicId` declarado no `SessionRepository`, implementado no adaptador Drizzle com as quatro condições no mesmo `WHERE` e espelhado no adaptador em memória
* `session_revoked` acrescentado a `REVOKED_REASONS` e gravado em `revoked_reason` na revogação bem-sucedida, sem migration
* Service `revokeSession` coberto por teste, incluindo a chamada ao repositório, o log só quando houve revogação e o retorno idêntico nos dois casos
* Teste de rota provando o mesmo `204` para uuid inexistente, para sessão de outro usuário, que continua intacta, e para segunda revogação, que preserva o carimbo da primeira
* Teste de rota provando que a sessão atual é revogada sem caso especial e que nenhum `Set-Cookie` sai na resposta
* Teste de rota provando que o hash do token não aparece no corpo da resposta
* `pnpm typecheck`, `pnpm lint`, `pnpm test` e `pnpm build` verdes
