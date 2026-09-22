# 08. Login endpoint

## Introdução

O login parece o endpoint mais simples do fluxo, já que é comparar uma senha com um hash. Ele é, na prática, o mais fácil de errar de um jeito que não aparece em teste nenhum.

O erro clássico é sair cedo. Se o email não existe, a implementação natural responde na hora, e se existe ela verifica a senha, o que custa tempo mensurável porque Argon2 é caro de propósito. Duas respostas com a mesma mensagem mas tempos diferentes continuam contando quais emails estão cadastrados, e nenhum teste funcional reclama disso.

Esta etapa entrega `POST /auth/login` com essa armadilha fechada e cria uma sessão nova por dispositivo, reaproveitando o mesmo formato da sessão criada na confirmação do cadastro.

## Requisitos técnicos

### Contrato

* `POST /auth/login`, com body `{ email, password }` validado por Zod
* Email com formato validado e limite de 254 caracteres
* Senha aceita de 1 a 128 caracteres, deliberadamente **sem** a política mínima do cadastro. Login verifica uma senha que já existe, então aplicar a política aqui transformaria o comprimento num oráculo, revelando qual conta tem senha fora do padrão atual
* Sucesso responde `200` com `{ user: { publicId } }`
* Documentado no OpenAPI com os três status possíveis

### O corpo da resposta

O que fica de fora importa mais do que o que fica dentro.

* Sem token de sessão, porque ele vive no cookie `HttpOnly` e devolvê-lo no JSON entregaria de volta exatamente a proteção contra scripts maliciosos que o cookie oferece
* Sem o identificador interno, que é sequencial e revelaria o tamanho da base
* Sem email, porque quem acabou de digitar já sabe
* Sem hash de senha, que nunca deve sair do servidor em nenhuma circunstância

### Tempo constante

* Email normalizado com `trim` e lowercase antes da busca, do mesmo jeito que no cadastro
* Exatamente uma verificação Argon2 por tentativa, sempre. Quando o email não existe, a verificação roda contra um hash pré-computado que nunca corresponde a senha nenhuma, e o resultado é descartado
* Comparação sempre por `argon2.verify()`, que já é de tempo constante, nunca por igualdade direta
* O hash pré-computado fica numa constante do módulo de senha, gerado uma vez com os mesmos parâmetros dos hashes reais, de modo que o custo bata

### Resposta de erro única

Email inexistente e senha errada produzem resposta idêntica: mesmo status `401`, mesma mensagem, nenhum cookie. Somado ao tempo constante, isso fecha os dois canais pelos quais um endpoint de login costuma confirmar se um endereço está cadastrado.

### A sessão

* Token de 32 bytes aleatórios em base64url, com apenas o SHA-256 gravado na tabela de sessões
* Tempo de vida de 30 dias, com o mesmo valor na coluna de expiração e no `Max-Age` do cookie
* Rótulo do dispositivo vindo do `User-Agent` truncado em 256 caracteres
* Cookie `session` com `HttpOnly`, `Secure`, `SameSite=Strict` e `Path=/`, no mesmo formato da sessão criada ao confirmar o cadastro, para que exista um único conceito de sessão no sistema
* Cada login cria uma linha nova, então entrar pelo celular não derruba a sessão do computador

### Logs

* Tentativa falha registra o motivo, distinguindo email desconhecido de senha incorreta, e o identificador do usuário quando ele existe
* Essa distinção fica apenas no log, jamais na resposta, e é o insumo para detectar ataque de força bruta depois
* Senha, email e token nunca entram em log

## Definition of done

* Contrato publicado no OpenAPI, com os três status descritos
* Request e response tipados e validados por schema Zod
* Teste do caminho feliz conferindo a criação da sessão, o hash gravado diferente do token do cookie e o corpo contendo apenas o identificador público
* Teste de email inexistente e de senha errada produzindo resposta idêntica
* Teste garantindo que a verificação Argon2 roda também quando o email não existe
* Teste de normalização do email, com maiúsculas e espaços chegando à mesma conta
* Teste de validação de body respondendo 400
