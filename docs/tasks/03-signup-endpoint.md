# 03. Signup endpoint

## Introdução

O cadastro é o endpoint mais exposto de qualquer aplicação, porque aceita requisição de quem ainda não tem conta. Duas preocupações mandam no desenho: ele não pode revelar quais emails já existem, e não pode criar conta antes de provar que a pessoa controla aquele email.

A solução para as duas é a mesma linha de raciocínio. Nada é criado em `auth_users` neste momento, apenas um cadastro pendente com um código de 6 dígitos, e a resposta é a mesma independentemente de o email já existir, já estar pendente ou ser novo.

Esta etapa entrega `POST /auth/signup` completo, exceto o disparo do email, que entra logo em seguida através de um ponto de integração injetado.

## Requisitos técnicos

### Contrato

* `POST /auth/signup`, com prefixo `/auth` agrupando todo o fluxo, o que depois facilita aplicar rate limit e hooks por prefixo. O prefixo vem do nome da pasta `src/routes/auth/`, que o autoload aplica sozinho, então o arquivo de rota registra apenas `/signup`
* Body validado por Zod: `{ email, password }`
* Resposta de sucesso `202 Accepted` com `{ "message": "If the email is valid, we sent a confirmation code." }`
* O status 202 é o mais honesto aqui, porque o envio de email é assíncrono e nada garante entrega no momento da resposta. Ele também evita o 201, que anunciaria criação de recurso e com isso entregaria a informação que se quer esconder
* Documentado no OpenAPI a partir dos próprios schemas Zod

### Validação de entrada

* Email validado por `z.email()` no backend, com limite de 254 caracteres, que é o teto prático do RFC. Validação no front é usabilidade, não segurança, então ela não substitui esta
* Senha entre 15 e 128 caracteres, sem regra de composição. O mínimo de 15 segue a recomendação do NIST para autenticação sem segundo fator, e regras de composição são conhecidas por empurrar as pessoas para senhas previsíveis como `Senha@123`
* Todos os caracteres aceitos, incluindo espaço e unicode, e nunca truncar silenciosamente
* Erros de validação respondem 400 detalhado por campo. Isso não fere o anti-enumeração, porque fala do formato do que foi enviado e nunca da existência de conta

### Senhas vazadas

* Checagem contra a API Pwned Passwords usando k-anonymity: calcula o SHA-1 da senha, envia apenas os 5 primeiros caracteres do hash e compara o sufixo localmente na lista devolvida. A senha completa nunca sai do processo
* Qualquer ocorrência rejeita, respondendo 400 com mensagem que fala apenas da senha, sugerindo escolher outra, sem mencionar contas
* Timeout de 2 segundos e comportamento **fail open**: se o serviço externo cair, o cadastro continua e a falha vira log de aviso. Indisponibilidade de terceiro não pode derrubar o cadastro do seu produto

### Normalização e idempotência

* Email recebe `trim` e lowercase antes de qualquer consulta ou gravação, de modo que `Foo@Gmail.com` e `foo@gmail.com` sejam a mesma conta
* Se já existe cadastro pendente não expirado para aquele email, nada é criado nem reenviado, mas o token de sessão rotaciona: a resposta devolve um valor novo, gravado na linha por um `UPDATE` chaveado pelo email, e nenhum outro campo muda, nem código, nem tentativas, nem contagem de envios, nem expiração. O código que já está na caixa de entrada continua valendo, porque a validade dele mora no hash e no `expires_at` da linha, não no token. Reenvio é responsabilidade explícita de outro endpoint
* A rotação tem um custo aceito de propósito: qualquer anônimo que chame o endpoint com o email de outra pessoa invalida o cookie do cadastro em andamento dela. A troca compensa porque a alternativa é devolver um valor estável, que entrega por enumeração quais endereços já têm conta, e porque a recuperação é barata, já que a chamada seguinte da vítima devolve um cookie válido e o código que ela recebeu continua valendo
* Se o pendente existe mas expirou, ele é substituído atomicamente por `INSERT ... ON CONFLICT (email) DO UPDATE`, que troca senha, código, token e expiração, zera as tentativas e renova os contadores
* O upsert resolve dois problemas de uma vez: a constraint `UNIQUE` de email nunca estoura como erro para quem está cadastrando, e duas requisições simultâneas do mesmo email não criam estado inconsistente
* Uma sutileza do upsert vale registrar: valores `DEFAULT` da tabela só disparam em insert de verdade, então a cláusula de update precisa renovar `created_at`, `last_sent_at` e `code_send_count` explicitamente

### Código e token

* Código de 6 dígitos por `crypto.randomInt`, com padding à esquerda para que `000042` seja um código válido
* O código em claro existe apenas em memória no instante da geração. No banco fica só o SHA-256, e ele nunca aparece em log nem na resposta
* Token de sessão de cadastro com 32 bytes aleatórios em base64url, ou seja 256 bits, guardado na coluna própria
* Tempo de vida do cadastro pendente de 15 minutos, o mesmo valor usado no `Max-Age` do cookie

### Resposta e cookie

* Cookie `signup_session` com `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/auth` e `Max-Age` de 900 segundos
* A resposta é byte a byte idêntica nos três caminhos possíveis, incluindo a presença do cookie. Quando o email pertence a uma conta já confirmada, nenhum código é gerado e o cookie recebe um token descartável, justamente para que a resposta não se diferencie. A indistinguibilidade cobre também o valor do cookie, e é por isso que nenhum dos três caminhos pode devolver um valor que se repita entre chamadas: um valor estável para um endereço e variável para outro responderia, em duas requisições, quais endereços já têm conta
* O `Path=/auth` mantém esse cookie restrito ao fluxo de cadastro, sem acompanhar requisições ao resto da API

### Organização do código

* A rota fica em `src/routes/auth/signup.ts` e cuida apenas de HTTP: valida o body com o schema de `src/schemas/auth.ts`, chama `app.auth.signup` e traduz o resultado em status, mensagem e cookie
* A regra de negócio fica em `src/plugins/app/auth/signup.ts`, numa função `createSignupService(deps)` que recebe repositório, remetente de email e verificador de senha vazada como parâmetro. Ela devolve um resultado discriminado (`accepted`, `pwned-password`) em vez de lançar erro ou conhecer status HTTP, e por isso é testável sem subir Fastify
* O plugin `src/plugins/app/auth/index.ts` monta esse service junto dos demais fluxos e decora a instância como `fastify.auth`. Ele declara `dependencies` para `database`, `email-sender` e `pwned-password`, porque lê `fastify.db`, `fastify.emailSender` e `fastify.checkPwnedPassword` ao montar o módulo
* A verificação de senha vazada é o plugin `src/plugins/app/pwned-password/`, cujo `index.ts` decora `fastify.checkPwnedPassword` com o verificador de `checker.ts`. Ela sai de `lib/` porque faz HTTP e precisa de comportamento diferente em teste e em produção, e `lib/` é só para função pura
* O acesso ao banco passa pela interface `AuthRepository`. O service depende de um `Pick` dos quatro métodos que usa, o adaptador Drizzle em `auth/drizzle-repository.ts` implementa a interface inteira, e o adaptador em memória de `tests/helpers/auth/` substitui o banco nos testes de rota. Testar com um falso do ORM seria testar a implementação do repositório pelo lado errado
* Tudo isso chega aos testes por `AppOptions`: `buildApp` recebe `authRepository`, `emailSender` e `checkPwnedPassword` opcionais, e cada plugin usa o que veio ou monta a implementação real a partir de `config`
* O service grava primeiro e envia depois, ordem coberta por teste, para nunca existir código enviado que não esteja registrado
* O envio sai do caminho da requisição, disparado com `void` depois que a linha está gravada, de modo que o tempo de resposta não separa um endereço novo de um que já tem conta confirmada. O documento 15 traz o raciocínio completo dessa decisão

## Definition of done

* Contrato publicado no OpenAPI, com os três status possíveis descritos
* Request e response tipados e validados pelo mesmo schema Zod
* Testes unitários cobrindo validação de email e senha, normalização, rotação do token no pendente válido sem criar nem reenviar nada, substituição do pendente expirado, resposta genérica nos três caminhos, ordem de gravar antes de enviar e rejeição de senha vazada
* Teste do verificador de senha vazada cobrindo ocorrência encontrada, ausência e indisponibilidade do serviço com fail open
* Teste de service com o repositório em memória e teste de rota com `app.inject`, e nenhum dos dois toca banco ou rede reais, porque os colaboradores chegam por `AppOptions`
