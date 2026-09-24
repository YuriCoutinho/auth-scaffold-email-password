# 13. Revoke session endpoint

## Introdução

A etapa anterior entregou a lista de sessões ativas, que é a tela de dispositivos conectados vista pelo lado do servidor. Olhar para a lista e reconhecer uma sessão que não deveria estar ali só tem valor se existir o botão ao lado dela, e é esse botão que falta. Sem ele, quem enxerga um acesso estranho num computador emprestado continua com a opção nuclear como única saída, derrubando junto tudo o que estava funcionando.

Esta etapa entrega `DELETE /sessions/:sessionId`, que encerra uma sessão do usuário autenticado identificada pelo id que a listagem devolve, apagando a linha dela. Com ela, a coleção `/sessions` fecha o trio de revogação: `DELETE /sessions/current` derruba o dispositivo atual, `DELETE /sessions` derruba os demais de uma vez, e `DELETE /sessions/:sessionId` derruba exatamente um, escolhido pelo usuário.

O endpoint nasce da tela de dispositivos conectados e assume o contrato que ela já tem em mãos. Cada linha da listagem traz um `id`, que é o uuid da sessão, então revogar é devolver ao servidor o mesmo identificador que ele acabou de entregar, sem que o frontend precise conhecer nada sobre como aquela sessão é guardada.

## Requisitos técnicos

### Onde o código fica

A rota é `src/routes/sessions/revoke.ts`, registrando `DELETE /:sessionId` dentro da pasta cujo nome já é o prefixo, no mesmo desenho de `list.ts`, `current.ts` e `all.ts`. O service é `src/plugins/app/sessions/revoke-session.ts` e chega à rota por `app.sessions.revokeSession`, montado em `create-sessions.ts` ao lado de `logout`, `logoutAll` e `listSessions`. O acesso ao banco é `deleteUserSession`, declarado na porta `SessionRepository` e implementado tanto no adaptador Drizzle quanto no adaptador em memória dos testes. Nada em `sessions/` importa de `auth/`, porque sessão e identidade continuam se encontrando no request e não nos módulos.

### O identificador é o uuid da sessão

O caminho da rota recebe o uuid que `GET /sessions` devolve, que é a própria chave primária de `sessions`. Um id sequencial num caminho público seria enumerável, convidaria a tentar vizinhos e, pior que isso, contaria o volume: quem conhece dois ids saberia quantas sessões o sistema emitiu entre eles. O uuid gerado pela aplicação não tem esse problema, e aqui essa escolha se paga, porque o identificador que já era seguro de mostrar é também seguro de receber de volta.

Nenhuma migration foi necessária. A busca é pela chave primária, que já é indexada.

### A resposta é sempre `204`, tenha revogado ou não

A rota responde `204` sem corpo quando a sessão foi encerrada, quando o uuid não existe, quando pertence a outro usuário, quando já tinha sido encerrada e quando já havia expirado. Qualquer diferença entre esses casos, seja um `404`, um corpo ou um header a mais, transformaria o endpoint num oráculo: bastaria varrer uuids e ler o status para descobrir quais sessões existem e de quem são. Como uuid v4 não é adivinhável, essa varredura é impraticável, e a resposta uniforme garante que ela também seja inútil.

É a mesma escolha que `DELETE /sessions/current` já tinha feito por um motivo parecido, e o efeito colateral é bom para o cliente: revogar duas vezes a mesma sessão, porque alguém clicou duas vezes ou porque a tela estava desatualizada, é indistinguível de revogar uma vez.

### Identificação e autorização viajam no mesmo `WHERE`

`deleteUserSession` faz um único `DELETE` cujo `WHERE` carrega duas condições ao mesmo tempo: `id` igual ao do caminho e `user_id` igual ao do usuário autenticado. Não há leitura antes da escrita.

Juntar identificação e autorização na mesma cláusula é o que torna impossível encerrar sessão alheia, mesmo que o service esqueça uma verificação ou que uma refatoração futura reordene o fluxo. Uma sessão de outro dono simplesmente não casa linha nenhuma. Separar isso em "ler a sessão, conferir o dono, então apagar" daria o mesmo resultado no caminho feliz e abriria uma janela entre a conferência e a escrita, além de deixar a regra dependente de uma linha que alguém pode remover sem que teste nenhum de leitura acuse.

A idempotência vem da natureza do `DELETE`: a segunda chamada não encontra mais a linha e termina sem efeito.

O filtro não olha a validade. Uma sessão vencida ainda não apagada pela limpeza periódica não aparece em `GET /sessions` e não autentica requisição nenhuma, e apagá-la por esta rota é inofensivo, porque ela já estava morta e a resposta é o mesmo `204` de qualquer outro caso. Não existe história falsa a contar, já que a tabela não guarda motivo de encerramento.

### Não existe caso especial para a sessão atual

Se o uuid enviado for o da própria sessão que está fazendo a requisição, ela é encerrada como qualquer outra. A rota não compara o alvo com `request.session.id`, não limpa o cookie e não ramifica a resposta.

Quem separa "este dispositivo" dos demais é a tela, pelo `isCurrent` que a listagem devolve justamente para isso. Trazer essa distinção para o servidor significaria ou recusar a operação, inventando um erro que nada pede, ou duplicar aqui o comportamento de cookie que pertence a `DELETE /sessions/current`. A rota faz uma coisa só, e sair do dispositivo atual continua tendo um endereço próprio, que sabe limpar o cookie porque essa sempre foi a responsabilidade dele.

Como consequência, o cookie nunca é tocado por esta rota, e um teste prova que nenhum `Set-Cookie` sai na resposta.

### O id malformado recebe `400`, e isso não vaza nada

O caminho é validado com `sessionParamsSchema`, que é `z.object({ sessionId: z.uuid() })`, em `src/schemas/sessions.ts`. Um `:sessionId` que não é uuid recebe `400` sem que nenhuma consulta pela sessão alvo aconteça. A validação do Zod roda depois do hook `authenticate`, que é `onRequest` e já consultou o banco pelo hash do cookie para provar quem está chamando, então o que o `400` garante não é que o banco ficou intocado, e sim que o identificador do caminho nunca foi procurado nele.

Isso parece contradizer a resposta uniforme, e não contradiz, porque as duas perguntas são diferentes. O `204` esconde se um identificador bem formado corresponde a alguma sessão, que é informação sobre dados. O `400` diz que a requisição não é sequer uma pergunta válida, que é informação sobre a forma da string, e a mesma string recebe a mesma recusa em qualquer instalação do projeto, independentemente do que exista no banco. É por isso que ele não vira oráculo. Engolir esse caso com um `204` faria um bug de cliente, como enviar `undefined` no lugar do id, passar despercebido para sempre.

A validação também é o que garante que `DELETE /sessions/current` e `DELETE /sessions/:sessionId` não colidam. O Fastify casa rota estática antes de paramétrica, então `current` chega sempre ao seu próprio handler, e ainda que a ordem mudasse, a string `current` nunca seria aceita como uuid.

### O service resolve `void` e o log é detalhado

`revokeSession` recebe `{ userId, sessionId }`, chama o repositório e resolve `void`, mesmo o repositório informando se alguma linha foi apagada. Devolver o booleano até a rota não teria consumidor e só convidaria alguém a ramificar a resposta em algum momento, que é exatamente o oráculo que esta etapa evita. O tipo fecha a porta antes de ela existir.

A informação não se perde, ela muda de destino. Quando houve encerramento de fato, o service escreve uma linha de log com `userId` e `sessionId`, e é justamente por nunca sair do servidor que essa linha pode ser específica enquanto a resposta permanece genérica. Como a tabela não guarda histórico, é essa linha que registra o evento. Quando nada foi apagado, nenhuma linha é escrita, porque uma chamada que não mudou o estado não é evento. Nenhum token, hash de token ou email aparece no log.

## Definition of done

* `DELETE /sessions/:sessionId` respondendo `204` sem corpo, com o contrato publicado no OpenAPI sob a tag `sessions`
* `:sessionId` validado como uuid por schema Zod, respondendo `400` sem que a sessão alvo chegue a ser procurada no banco, com o contrato do erro declarado na rota
* Rota atrás do hook `authenticate`, respondendo o `401` genérico com `{ "message": "Unauthorized." }` quando o cookie está ausente, desconhecido ou expirado
* `deleteUserSession` declarado no `SessionRepository`, implementado no adaptador Drizzle com as duas condições no mesmo `WHERE` e espelhado no adaptador em memória
* Service `revokeSession` coberto por teste, incluindo a chamada ao repositório, o log só quando houve encerramento e o retorno idêntico nos dois casos
* Teste de rota provando o mesmo `204` para uuid inexistente, para sessão de outro usuário, que continua intacta, para segunda chamada e para sessão já vencida
* Teste de rota provando que a sessão atual é encerrada sem caso especial e que nenhum `Set-Cookie` sai na resposta
* Teste de rota provando que o hash do token não aparece no corpo da resposta
* `pnpm typecheck`, `pnpm lint`, `pnpm test` e `pnpm build` verdes
