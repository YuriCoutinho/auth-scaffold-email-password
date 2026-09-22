# 03. Signup endpoint

## Introdução

O cadastro é o endpoint mais exposto de qualquer aplicação, porque aceita requisição de quem ainda não tem conta. Duas preocupações mandam no desenho: ele não pode revelar quais emails já existem, e não pode criar conta antes de provar que a pessoa controla aquele email.

A solução para as duas é a mesma linha de raciocínio. Nada é criado em `auth_users` neste momento, apenas um cadastro pendente com um código de 6 dígitos, e a resposta é a mesma independentemente de o email já existir, já estar pendente ou ser novo.

Esta etapa entrega `POST /auth/signup` completo, exceto o disparo do email, que entra logo em seguida através de um ponto de integração injetado.

## Requisitos técnicos

### Contrato

* `POST /auth/signup`, com prefixo `/auth` agrupando todo o fluxo, o que depois facilita aplicar rate limit e hooks por prefixo
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
* Se já existe cadastro pendente não expirado para aquele email, nada é criado nem reenviado, e a resposta devolve o token já armazenado. Reenvio é responsabilidade explícita de outro endpoint
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
* A resposta é byte a byte idêntica nos três caminhos possíveis, incluindo a presença do cookie. Quando o email pertence a uma conta já confirmada, nenhum código é gerado e o cookie recebe um token descartável, justamente para que a resposta não se diferencie
* O `Path=/auth` mantém esse cookie restrito ao fluxo de cadastro, sem acompanhar requisições ao resto da API

### Organização do código

* `buildApp(deps)` recebe banco, remetente de email e verificador de senha vazada, enquanto `server.ts` monta as implementações reais. Isso permite testar o app inteiro sem tocar banco nem rede
* Rota fina em `src/routes/auth/signup.ts`, cuidando de HTTP e cookie, e regra de negócio em `src/services/signup.ts`, testável sem subir Fastify
* O service grava primeiro e envia depois, ordem coberta por teste, para nunca existir código enviado que não esteja registrado

## Definition of done

* Contrato publicado no OpenAPI, com os três status possíveis descritos
* Request e response tipados e validados pelo mesmo schema Zod
* Testes unitários cobrindo validação de email e senha, normalização, idempotência do pendente válido, substituição do pendente expirado, resposta genérica nos três caminhos, ordem de gravar antes de enviar e rejeição de senha vazada
* Teste do verificador de senha vazada cobrindo ocorrência encontrada, ausência e indisponibilidade do serviço com fail open
* Nenhum teste toca banco ou rede reais, usando a injeção de dependências do `buildApp`
