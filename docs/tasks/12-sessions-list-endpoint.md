# 12. Sessions list endpoint

## Introdução

As etapas anteriores deram ao usuário duas formas de encerrar sessão, uma que derruba o dispositivo atual e outra que derruba todos os outros de uma vez. Falta o que fica entre as duas, que é olhar para a própria conta e ver onde ela está aberta. Sem essa lista, quem desconfia de um acesso indevido só tem a opção nuclear, e quem simplesmente esqueceu uma sessão aberta num computador emprestado não tem como saber que ela existe.

Esta etapa entrega `GET /sessions`, que devolve as sessões ativas do usuário autenticado, da mais recente para a mais antiga, cada uma com um identificador público próprio, o rótulo do dispositivo, o momento da criação, o momento da expiração e um sinalizador dizendo se aquela é a sessão que está fazendo a requisição.

O endpoint alimenta uma tela de dispositivos conectados e prepara o terreno para a revogação de um dispositivo específico, que precisa exatamente disso: um identificador por sessão que possa viajar até o frontend e voltar sem revelar nada sobre o banco.

## Requisitos técnicos

### A rota é `/sessions`, na raiz, e não `/auth/sessions`

Todo caminho sob `/auth` neste projeto é um verbo de fluxo de credencial, como `signup`, `login`, `verify-code` e `resend-code`. Sessão não é isso, é um recurso do usuário autenticado, e o `/me` já firmou que recurso do usuário autenticado fica na raiz. Colocar a lista sob `/auth` misturaria duas naturezas de rota no mesmo prefixo, e o prefixo deixaria de significar alguma coisa.

Pelo mesmo motivo, a tag do Swagger vira `sessions`, e `POST /auth/logout` e `POST /auth/logout-all` migram junto. Os dois tratam do ciclo de vida da sessão, não da credencial, e deixar metade dessa vida em cada grupo seria o pior dos dois mundos para quem lê a documentação. O `/me` continua em `auth` porque o que ele lê é o usuário.

### A sessão ganha um `public_id` e a chave primária nunca sai

A chave primária de `sessions` é um serial, ótimo para chave estrangeira e junção, e péssimo para aparecer numa resposta. Id sequencial é enumerável, permite tentar vizinhos e deixa estimar quantos registros foram criados entre dois que alguém conhece. A tabela `auth_users` já resolvia isso com um `public_id` em uuid ao lado da chave interna, e `sessions` passa a seguir o mesmo padrão, com `NOT NULL`, `UNIQUE` e default aleatório gerado pelo Postgres.

No JSON esse campo se chama apenas `id`. Dentro de `GET /sessions` não existe id concorrente no payload, então chamar de `publicId` carregaria para fora uma distinção que só faz sentido dentro do backend.

A mesma etapa aproveita para remover `last_used_at` do schema. A coluna foi criada na modelagem inicial e nunca recebeu uma escrita sequer, porque atualizá-la significaria um `UPDATE` em toda requisição autenticada do sistema. Mantê-la e devolver `null` seria um campo que mente sobre a atividade da sessão, e o projeto prefere resolver o requisito concreto a preservar o hipotético.

Como não existe nada em produção nem em staging, a pasta `drizzle/` é regenerada do zero em vez de ganhar uma migration de `DROP COLUMN`. Quem reconstrói o projeto a partir desta documentação aplica uma migration só, já com o schema final, sem passar pela arqueologia de uma coluna que, na receita, nunca existiu. Como o hash gravado em `__drizzle_migrations` não corresponde mais ao arquivo reescrito, o banco local nasce de novo com `docker compose down -v` antes de `pnpm db:migrate`.

### O `token_hash` fica fora até da projeção da query

A leitura entra no seam `AuthRepository` como `listActiveUserSessions`, e a projeção do `SELECT` lista campo por campo: id interno, id público, rótulo do dispositivo, criação e expiração. O hash do token não está lá.

Isso é mais forte do que filtrar o campo depois, na rota ou no service, porque a coluna nunca chega a sair do repositório. Não existe ponto no caminho em que um `...spread` distraído possa vazá-la, e o teste que garante isso procura o hash no corpo bruto da resposta, não numa propriedade específica.

### O filtro de sessão ativa e o limite exato

Uma sessão entra na lista quando `user_id` é o do usuário autenticado, `revoked_at` é nulo e `expires_at` é maior que o instante atual. É o mesmo predicado que o hook de autenticação usa para aceitar um cookie, e essa coincidência é intencional: a lista mostra exatamente as sessões que conseguiriam autenticar uma requisição agora.

A comparação é `expires_at > now()` e não `>=`, então a sessão que expira no instante exato fica de fora. Uma sessão que vence agora já não abre nada, e mostrá-la como ativa daria ao usuário uma informação falsa no momento em que ela mais engana. O caso está coberto por teste, porque é o tipo de limite que uma refatoração troca sem querer.

A ordenação é por `created_at` decrescente. Com `last_used_at` fora do modelo, esse é o único sinal temporal de atividade que existe, e a sessão mais nova é a que o usuário tem mais chance de reconhecer como sua.

### O `isCurrent` é derivado no service, não na rota

O id interno viaja do repositório até o service justamente para ser comparado com o id da sessão que o hook publicou em `request.session`, e é ali que ele morre: o service devolve o id público e o booleano, e o serial não aparece no objeto de saída.

Colocar essa comparação na rota pareceria mais curto, mas espalharia a regra. Quem decide qual sessão é a atual é um dono só, e o dia em que a revogação de um dispositivo precisar da mesma decisão, para impedir o usuário de se derrubar sem querer, ela já está pronta e testada num lugar só.

A conversão de `Date` para string ISO 8601 acontece na rota, e não no service, pela razão simétrica. `Date` é o tipo honesto dentro do domínio, e ISO 8601 é uma decisão de transporte, que pertence à camada que fala HTTP.

### O `device_label` vai cru e o `expires_at` é devolvido

O rótulo do dispositivo é a string de `User-Agent` truncada em 256 caracteres, escrita de verdade em todo login e em toda confirmação de código. Ele sai da API exatamente como entrou. Transformar `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)` em "Chrome no Mac" é decisão de apresentação, depende do idioma e do espaço da tela, e muda com a moda dos navegadores. O backend entrega o dado, o frontend decide como mostrar.

O `expires_at` é devolvido mesmo sendo derivável de `created_at` mais o TTL fixo. É uma coluna real da linha, não um cálculo do cliente, e fazer o frontend somar o TTL espalharia uma constante do backend para fora, criando dois lugares que precisam concordar sobre quanto dura uma sessão.

### O envelope e a resposta de erro

A resposta é `{ "sessions": [...] }`, seguindo o envelope que o `/me` firmou com `{ "user": {...} }`. Um array na raiz fecharia a porta para qualquer campo de acompanhamento depois, como uma contagem ou um cursor, e abrir essa porta mais tarde quebraria o contrato de quem já consome.

Um usuário sem nenhuma sessão ativa recebe `200` com a lista vazia. Lista vazia é uma resposta legítima para uma consulta que funcionou, e `404` seria dizer que o recurso não existe quando ele existe e está vazio. Na prática o caso é raro, porque a requisição chegou até aqui com um cookie válido, mas o comportamento está fixado por teste.

A recusa é o mesmo `401` genérico com `{ "message": "Unauthorized." }` para cookie ausente, desconhecido, revogado ou expirado, pelo motivo de sempre: distinguir os casos transformaria a rota num oráculo sobre quais tokens já existiram.

## Definition of done

* `sessions` com `public_id` em uuid, `NOT NULL`, `UNIQUE` e default aleatório, sem `last_used_at`, e migration regenerada e aplicada num Postgres 16 local
* `listActiveUserSessions` declarado no `AuthRepository`, implementado no adaptador Drizzle com o filtro e a ordenação, e espelhado no adaptador em memória
* Service `listSessions` cobrindo lista vazia, derivação do `isCurrent` e ausência do id interno na saída
* `GET /sessions` cobrindo a listagem ordenada com a sessão atual sinalizada, a ausência do hash do token na resposta, a sessão de outro usuário fora da lista e o `401` genérico para cookie ausente, revogado e expirado
* Sessão que expira no instante exato comprovadamente fora da lista
* `GET /sessions`, `POST /auth/logout` e `POST /auth/logout-all` agrupados sob a tag `sessions` no Swagger UI
* `pnpm typecheck`, `pnpm lint`, `pnpm test` e `pnpm build` verdes
