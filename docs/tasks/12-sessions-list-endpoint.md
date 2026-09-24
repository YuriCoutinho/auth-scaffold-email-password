# 12. Sessions list endpoint

## Introdução

As etapas anteriores deram ao usuário duas formas de encerrar sessão, uma que derruba o dispositivo atual e outra que derruba todos os outros de uma vez. Falta o que fica entre as duas, que é olhar para a própria conta e ver onde ela está aberta. Sem essa lista, quem desconfia de um acesso indevido só tem a opção nuclear, e quem simplesmente esqueceu uma sessão aberta num computador emprestado não tem como saber que ela existe.

Esta etapa entrega `GET /sessions`, que devolve as sessões ativas do usuário autenticado, da mais recente para a mais antiga, cada uma com o próprio id, o rótulo do dispositivo, o momento da criação, o momento da expiração e um sinalizador dizendo se aquela é a sessão que está fazendo a requisição.

O endpoint alimenta uma tela de dispositivos conectados e prepara o terreno para a revogação de um dispositivo específico, que precisa exatamente disso: um identificador por sessão que possa viajar até o frontend e voltar sem revelar nada sobre o banco.

## Requisitos técnicos

### A rota é `/sessions`, na raiz, e não `/auth/sessions`

Todo caminho sob `/auth` neste projeto é um verbo de fluxo de credencial, como `signup`, `login`, `verify-code` e `resend-code`. Sessão não é isso, é um recurso do usuário autenticado, e o `/me` já firmou que recurso do usuário autenticado fica na raiz. Colocar a lista sob `/auth` misturaria duas naturezas de rota no mesmo prefixo, e o prefixo deixaria de significar alguma coisa.

Pelo mesmo motivo, a coleção `/sessions` guarda as três operações de sessão e a tag do Swagger que as agrupa também se chama `sessions`. `GET /sessions` lista, `DELETE /sessions/current` derruba a deste dispositivo e `DELETE /sessions` derruba as outras. As três tratam do ciclo de vida da sessão, não da credencial, e deixar parte dessa vida em cada grupo seria o pior dos dois mundos para quem lê a documentação. O `/me` continua em `auth` porque o que ele lê é o usuário.

Os arquivos seguem o mesmo desenho: `src/routes/sessions/` é a pasta cujo nome vira o prefixo, e dentro dela `list.ts` registra `GET /`, `current.ts` registra `DELETE /current` e `all.ts` registra `DELETE /`. Nenhuma rota repete o prefixo no próprio caminho, então mover a coleção inteira é renomear uma pasta.

### O id da sessão é o uuid da chave primária

A chave primária de `sessions` é o `uuid` que a aplicação gera ao criar a sessão, e é ele que sai na resposta como `id`. Um id sequencial seria enumerável, permitiria tentar vizinhos e deixaria estimar quantos registros foram criados entre dois que alguém conhece. Um uuid v4 não tem nenhum desses problemas, então a mesma coluna serve à chave estrangeira, à junção e à resposta, sem um segundo identificador para manter em sincronia.

### O `token_hash` fica fora até da projeção da query

A leitura entra no seam `SessionRepository` como `listUserSessions`, e a projeção do `SELECT` lista campo por campo: id, rótulo do dispositivo e criação. O hash do token não está lá.

Isso é mais forte do que filtrar o campo depois, na rota ou no service, porque a coluna nunca chega a sair do repositório. Não existe ponto no caminho em que um `...spread` distraído possa vazá-la, e o teste que garante isso procura o hash no corpo bruto da resposta, não numa propriedade específica.

### O filtro de sessão ativa e o limite exato

Uma sessão entra na lista quando `user_id` é o do usuário autenticado e `created_at` é maior que o corte, que é o instante atual menos o tempo de vida da sessão. O service calcula o corte com `issuedAfter` da política de TTL e o passa ao repositório como `createdAfter`, então a regra de validade continua num lugar só e o SQL só recebe uma data. É o mesmo predicado que o hook de autenticação usa para aceitar um cookie, e essa coincidência é intencional: a lista mostra exatamente as sessões que conseguiriam autenticar uma requisição agora. Sessões encerradas nem entram na conta, porque encerrar apaga a linha.

A comparação é `created_at > corte` e não `>=`, então a sessão que expira no instante exato fica de fora. Uma sessão que vence agora já não abre nada, e mostrá-la como ativa daria ao usuário uma informação falsa no momento em que ela mais engana. O caso está coberto por teste, porque é o tipo de limite que uma refatoração troca sem querer.

A ordenação é por `created_at` decrescente, com o `id` decrescente como desempate, para que duas sessões criadas no mesmo instante saiam sempre na mesma ordem em vez de ficarem a critério do plano de execução do Postgres. A criação é o único sinal temporal de atividade que a linha guarda, e a sessão mais nova é a que o usuário tem mais chance de reconhecer como sua.

### O service é da fatia de sessão, exposto por `fastify.sessions`

`listSessions` vive em `src/plugins/app/sessions/list-sessions.ts` e chega à rota por `app.sessions.listSessions`, ao lado de `logout` e `logoutAll`. Ele não passa por `fastify.auth`, que guarda os fluxos de identidade, e depende apenas de `listUserSessions` da porta `SessionRepository` e do tempo de vida da sessão.

A rota continua lendo `request.user` e `request.session`, que o hook `authenticate` publica, e é só isso que ela precisa da fatia de identidade. Sessão e identidade se encontram no request, não nos módulos, e é por isso que `sessions/` não importa nada de `auth/`.

### O `isCurrent` é derivado no service, não na rota

O id de cada sessão é comparado no service com o id da sessão que o hook publicou em `request.session`, e o service devolve o booleano pronto ao lado do id.

Colocar essa comparação na rota pareceria mais curto, mas espalharia a regra. Quem decide qual sessão é a atual é um dono só, e o dia em que a revogação de um dispositivo precisar da mesma decisão, para impedir o usuário de se derrubar sem querer, ela já está pronta e testada num lugar só.

A conversão de `Date` para string ISO 8601 acontece na rota, e não no service, pela razão simétrica. `Date` é o tipo honesto dentro do domínio, e ISO 8601 é uma decisão de transporte, que pertence à camada que fala HTTP.

### O `device_label` vai cru e o `expiresAt` é devolvido

O rótulo do dispositivo é a string de `User-Agent` truncada em 256 caracteres, escrita de verdade em todo login e em toda confirmação de código. Ele sai da API exatamente como entrou. Transformar `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)` em "Chrome no Mac" é decisão de apresentação, depende do idioma e do espaço da tela, e muda com a moda dos navegadores. O backend entrega o dado, o frontend decide como mostrar.

O `expiresAt` é devolvido mesmo sendo derivável de `created_at` mais o TTL. O service o calcula com `expiresAt` da política de TTL, e fazer o frontend somar o TTL espalharia uma configuração do backend para fora, criando dois lugares que precisam concordar sobre quanto dura uma sessão. Como o TTL é configurável, o frontend nem teria como saber o valor certo.

### O envelope e a resposta de erro

A resposta é `{ "sessions": [...] }`, seguindo o envelope que o `/me` firmou com `{ "user": {...} }`. Um array na raiz fecharia a porta para qualquer campo de acompanhamento depois, como uma contagem ou um cursor, e abrir essa porta mais tarde quebraria o contrato de quem já consome.

Um usuário sem nenhuma sessão ativa recebe `200` com a lista vazia. Lista vazia é uma resposta legítima para uma consulta que funcionou, e `404` seria dizer que o recurso não existe quando ele existe e está vazio. Pela rota esse caminho é inalcançável, porque a requisição só chega aqui autenticada e o cookie que a autenticou pertence a uma sessão ativa, então quem fixa o comportamento é o teste do service, que chama o fluxo com um repositório sem nenhuma sessão.

A recusa é o mesmo `401` genérico com `{ "message": "Unauthorized." }` para cookie ausente, desconhecido ou expirado, pelo motivo de sempre: distinguir os casos transformaria a rota num oráculo sobre quais tokens já existiram.

## Definition of done

* `listUserSessions` declarado no `SessionRepository`, implementado no adaptador Drizzle com o filtro por `createdAfter` e a ordenação, e espelhado no adaptador em memória
* Service `listSessions` exposto por `fastify.sessions` e cobrindo lista vazia, derivação do `isCurrent`, o corte calculado a partir do TTL e o `expiresAt` derivado de `created_at`
* `GET /sessions` cobrindo a listagem ordenada com a sessão atual sinalizada, a ausência do hash do token na resposta, a sessão de outro usuário fora da lista e o `401` genérico para cookie ausente, desconhecido e expirado
* Sessão que expira no instante exato comprovadamente fora da lista
* `GET /sessions`, `DELETE /sessions/current` e `DELETE /sessions` agrupados sob a tag `sessions` no Swagger UI
* `pnpm typecheck`, `pnpm lint`, `pnpm test` e `pnpm build` verdes
