# 02. Data modeling

## Introdução

O schema é onde a maior parte das garantias de segurança de um fluxo de autenticação realmente mora. Se o email é único numa tabela só, nenhum código precisa lembrar de conferir duas tabelas antes de decidir se um endereço já tem conta. Se o identificador é aleatório, nenhuma rota vaza a ordem de criação das contas por acidente.

Esta etapa cria três tabelas, a política de tempo de vida e os utilitários de hash. Nenhuma rota ainda, apenas o vocabulário que todas as próximas etapas vão usar.

As três tabelas respondem a três perguntas diferentes: quem é a pessoa, que código de confirmação está em aberto para ela e quais dispositivos estão logados.

## Requisitos técnicos

### Convenções que valem para todas as tabelas

* Toda coluna de tempo é `timestamptz`, nunca `timestamp`. Sem fuso, qualquer comparação de expiração vira armadilha no primeiro deploy fora do seu horário local
* Chaves estrangeiras com `ON DELETE CASCADE`. Apagar a conta apaga códigos e sessões de verdade, o que também é o comportamento esperado por leis de proteção de dados
* `UNIQUE` já cria índice no Postgres, então índice explícito só onde não existe unicidade
* A chave primária de `users` e de `sessions` é um `uuid` v4 gerado pela aplicação, com `generateId` em `src/lib/id.ts`, e não pelo banco. Sendo aleatório, ele não revela quantas linhas existem nem em que ordem foram criadas, então a própria chave primária pode sair numa resposta e não existe uma segunda coluna de identificador público para manter em sincronia. Gerar na aplicação faz o service conhecer o id antes do `INSERT`, o que permite logar e referenciar a linha dentro da mesma operação, e faz o adaptador em memória dos testes se comportar exatamente como o banco
* Todo instante que entra num cálculo de validade ou de retenção vem do relógio da aplicação, gravado explicitamente, e nunca do `defaultNow` do banco. A comparação acontece na aplicação, então os dois lados precisam do mesmo relógio, e misturar o relógio do Postgres com o do processo cria uma diferença que aparece justamente no limite de uma expiração
* `updated_at` é renovado pelo `$onUpdate` do Drizzle, que injeta o valor em todo `UPDATE` feito pelo ORM, em vez de um trigger no banco. O projeto só escreve nessas tabelas pelo Drizzle, então a solução mais simples basta, e como essa coluna não entra em cálculo nenhum, o `defaultNow` basta para ela

### Onde fica

* O schema Drizzle vive em `src/db/schema.ts`, e `drizzle/` guarda um baseline único com o schema inicial inteiro, e não uma cadeia de migrations. Como o projeto é um scaffold e não existe banco em produção, toda mudança que faça parte desse schema inicial regenera o baseline; migration incremental só começa depois que o scaffold está fechado
* Os utilitários de hash vivem em `src/lib/`, que guarda apenas funções puras: `password.ts` para Argon2 e `token-hash.ts` para SHA-256. Nenhum dos dois varia entre ambientes, então não há colaborador para injetar e eles não viram plugin
* Nenhum outro módulo de `src/` fala com o banco diretamente. O acesso passa por duas interfaces, uma por fatia do domínio. `AuthRepository`, definida em `src/plugins/app/auth/repository.ts`, cobre identidade, ou seja usuário e código de confirmação. `SessionRepository`, definida em `src/plugins/app/sessions/repository.ts`, cobre a sessão. Cada uma ganha um adaptador Drizzle ao lado, em `drizzle-repository.ts` da própria pasta, e as duas são satisfeitas pelo mesmo adaptador em memória em `tests/helpers/auth/in-memory-repository.ts`, que guarda tudo num store só. Interface e adaptador ficam na pasta do domínio, e não em `db/`, porque o repositório é detalhe de quem o usa; `db/` só conhece schema e conexão. Cada interface cresce um endpoint por vez, cada um adicionando só os métodos de que precisa

### Tabela `users`

Uma linha por pessoa, com o cadastro confirmado ou não. Um `email_verified_at` nulo é o que um cadastro pendente é, e por isso o `UNIQUE` do email vale para os dois estados ao mesmo tempo: um endereço nunca consegue estar pendente e confirmado em lugares diferentes, e não existe corrida entre duas tabelas que não se conhecem.

| Campo | Tipo | Regra |
| --- | --- | --- |
| `id` | `uuid` | PK, gerado pela aplicação |
| `email` | `text` | `UNIQUE`, `NOT NULL` |
| `password_hash` | `text` | `NOT NULL` |
| `email_verified_at` | `timestamptz` | nullable, onde `NULL` significa cadastro não confirmado |
| `created_at` | `timestamptz` | `NOT NULL`, gravado pelo relógio da aplicação, indexado |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()`, renovado a cada alteração |

A alternativa seria uma tabela de cadastros pendentes separada da de contas, promovendo a linha de uma para a outra na confirmação. Ela parece mais limpa porque a tabela de contas só teria contas reais, e na prática duplica tudo: duas unicidades de email sem relação entre si, uma transação de promoção que move dados, e uma janela em que um cadastro lê uma tabela, a confirmação concorrente promove, e o cadastro lê a outra já vazia. Com uma tabela só, quem precisa de conta confirmada filtra por `email_verified_at`, e é o repositório que concentra esse filtro.

### Tabela `verification_codes`

Guarda o código de seis dígitos que prova posse do email. A chave primária é composta por `user_id` e `purpose`, o que garante no máximo um código em aberto por conta e por finalidade, e dá ao upsert o alvo de conflito. Nesta etapa a única finalidade é `signup`, num enum `verification_purpose`.

| Campo | Tipo | Regra |
| --- | --- | --- |
| `user_id` | `uuid` | FK para `users.id`, cascade, parte da PK |
| `purpose` | enum `verification_purpose` | parte da PK |
| `code_hash` | `text` | `NOT NULL`, SHA-256 do código de 6 dígitos |
| `token_hash` | `text` | `UNIQUE`, `NOT NULL`, SHA-256 do token que viaja no cookie |
| `code_attempts` | `integer` | `NOT NULL DEFAULT 0`, conta verificações erradas |
| `code_send_count` | `integer` | `NOT NULL DEFAULT 1`, conta emails enviados, já que o próprio pedido é o primeiro |
| `issued_at` | `timestamptz` | `NOT NULL`, gravado pelo relógio da aplicação, indexado |

Os dois contadores medem coisas diferentes e precisam existir separados: `code_attempts` protege contra adivinhar o código, enquanto `code_send_count` protege contra custo e abuso de envio de email.

`issued_at` é o único instante da linha, e ele faz o papel de três colunas: o início da validade, a base do cooldown de reenvio e a referência da retenção. Os três sempre andam juntos, porque todo envio de código novo recomeça a validade e o cooldown no mesmo instante, então guardar cada um numa coluna só daria três valores que podem discordar.

O token também é guardado só como hash, como o token de sessão. O valor em claro existe apenas no cookie. Em texto puro, um vazamento de leitura da tabela bastaria, somado à inversão trivial do hash de um código de seis dígitos, que tem só um milhão de valores possíveis, para concluir qualquer confirmação em andamento.

### Tabela `sessions`

Guarda apenas sessões vivas, uma linha por dispositivo logado, o que permite listar sessões ativas e encerrar uma delas sem derrubar as outras.

| Campo | Tipo | Regra |
| --- | --- | --- |
| `id` | `uuid` | PK, gerado pela aplicação, é o id que sai em resposta |
| `user_id` | `uuid` | FK para `users.id`, `NOT NULL`, cascade, indexado |
| `token_hash` | `text` | `UNIQUE`, `NOT NULL` |
| `device_label` | `text` | nullable, rótulo legível do dispositivo |
| `created_at` | `timestamptz` | `NOT NULL`, gravado pelo relógio da aplicação, indexado |

Encerrar uma sessão apaga a linha. Não existe coluna de revogação nem de motivo, porque uma tabela de negócio que acumula o histórico de tudo que já terminou cresce sem parar e mistura duas perguntas diferentes, "esta sessão vale agora" e "o que aconteceu com ela". A primeira é respondida pela existência da linha somada à validade, e a segunda pertence aos logs estruturados, que é onde o evento de encerramento fica registrado quando importa.

### Validade calculada na leitura

Nenhuma tabela guarda quando algo expira, só quando foi emitido. A validade é sempre o instante gravado mais o tempo de vida configurado, calculada na hora da leitura por `src/lib/ttl.ts`:

* `TtlPolicy` descreve os tempos de vida, e `DEFAULT_TTL` fixa os padrões: trinta dias para sessão e quinze minutos para o código de cadastro
* `resolveTtl` aplica as sobreposições sobre os padrões e valida cada valor com Zod como inteiro positivo, para que um zero, um negativo ou um fracionário derrube o boot em vez de produzir credenciais que já nascem mortas
* `expiresAt`, `isExpired` e `issuedAfter` são as três formas de usar a regra: calcular o fim da validade para mostrar, decidir se uma linha lida ainda vale e produzir o corte que uma consulta usa para filtrar linhas vivas

Guardar o fim da validade parece mais direto e espalha a regra: cada fluxo que emite calcula o prazo, cada fluxo que lê compara, parte no service e parte no SQL, e a mesma constante precisa bater em todos os lugares. Com a validade derivada, a regra mora num módulo só.

Existe um efeito assumido e que precisa estar documentado: como a validade é calculada a partir do tempo de vida atual, aumentar um TTL estende também as linhas que já existem, inclusive sessões vencidas que a limpeza periódica ainda não apagou. Reduzir um TTL, na direção oposta, encerra na hora o que passou do novo limite. As duas coisas são consequência de a política valer para o sistema inteiro no instante da leitura, e é o comportamento que se espera de uma configuração.

### Hash de senha

* Argon2id via `node-argon2`, usando os **parâmetros padrão da biblioteca**. Custo de memória e paralelismo são exatamente o tipo de parâmetro que se ajusta mal por intuição, e os defaults são mantidos por quem acompanha o estado da arte
* O salt é aleatório por senha e já vem embutido no hash de saída, então não existe coluna de salt
* Verificação sempre por `argon2.verify()`, que compara em tempo constante

### Hash de código e token

* SHA-256 em hexadecimal para o código de confirmação, para o token do código e para o token de sessão, cada um com a sua função em `token-hash.ts` para que o ponto de chamada diga o que está hasheando
* Usar hash barato aqui é decisão consciente, não descuido: a proteção do código de 6 dígitos vem do limite de tentativas e da expiração, e a dos tokens vem dos seus 256 bits de entropia. O hash existe para que um vazamento do banco não entregue credenciais utilizáveis, e para isso SHA-256 basta
* Senha é o caso oposto, porque é escolhida por humanos e tem entropia baixa, então ali o custo alto do Argon2 é justamente o ponto

## Definition of done

* Schema Drizzle das três tabelas escrito e baseline gerado e aplicado num Postgres 16 local
* Constraints, índices e cascatas conferidos no SQL gerado antes de aplicar
* Helper de hash de senha com teste cobrindo hash e verificação, incluindo senha errada
* Helper de SHA-256 com teste, verificando que a saída é estável e diferente da entrada
* `generateId` devolvendo uuid v4, com teste
* `src/lib/ttl.ts` com teste cobrindo os padrões, a sobreposição parcial, a recusa de valor não inteiro ou não positivo, e a expiração exatamente no instante limite
