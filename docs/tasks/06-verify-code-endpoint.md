# 06. Verify code endpoint

## Introdução

Esta é a etapa que transforma uma tentativa de cadastro em conta de verdade. Ela confirma o código, move os dados para as tabelas definitivas e já deixa a pessoa autenticada, sem pedir que ela faça login logo depois de provar quem é.

O ponto delicado é que várias coisas precisam acontecer juntas: criar o usuário, criar o perfil, apagar o cadastro pendente e abrir a sessão. Se qualquer uma falhar pela metade, sobra estado inconsistente, e o pior deles é um cadastro pendente apagado sem usuário criado, que apaga a conta de alguém que fez tudo certo.

A resposta para isso é uma transação só, com a sessão dentro dela. Ou tudo acontece, ou nada acontece e o código continua valendo para uma nova tentativa.

## Requisitos técnicos

### Contrato

* `POST /auth/verify-code`, com body `{ code }` validado por `^\d{6}$`
* O endpoint **nunca recebe email**, buscando o cadastro pelo token do cookie. Isso impede que alguém tente o mesmo código contra muitas contas diferentes
* Formato inválido cai no 400 automático da validação, que fala do formato e não revela nada sobre contas
* Sucesso responde `200` confirmando a conta e a sessão iniciada
* Documentado no OpenAPI com os três status possíveis

### Resposta de erro única

Todos os casos de falha respondem o mesmo `401` com a mesma mensagem: cookie ausente, token desconhecido, cadastro expirado, código errado e código invalidado por excesso de tentativas. Mensagens diferentes para cada caso pareceriam mais gentis, mas entregariam um oráculo para descobrir quais cadastros existem e em que estado estão.

### Limite de tentativas

* Máximo de 5 tentativas erradas por código
* A checagem do limite acontece **antes** de comparar o código. Assim o código esgotado fica inutilizável mesmo que o valor certo apareça depois, e isso se consegue sem coluna nova, apenas pela ordem das verificações
* Cada tentativa errada incrementa o contador direto no SQL, somando sobre o valor da coluna em vez de ler, somar e gravar, porque a segunda forma perde incrementos sob concorrência
* A saída do estado esgotado é pedir um código novo, que zera o contador, ou esperar a expiração
* Toda tentativa falha vira log, com o identificador do cadastro e a contagem, nunca com o código. Atingir o limite também é logado, porque é o insumo para detectar padrão de ataque depois

### A transação de promoção

Com o código correto, uma única transação executa quatro passos:

1. `INSERT` em `auth_users`, gerando o identificador público
2. `DELETE` do cadastro pendente
3. `INSERT` em `sessions` com o hash do token, o rótulo do dispositivo e a expiração
4. `INSERT` em `profiles` com apenas a referência ao usuário, deixando o resto nos valores padrão

Criar o perfil aqui dentro estabelece um invariante que o resto do sistema pode confiar: **todo usuário tem perfil**. A alternativa preguiçosa, criando o perfil na primeira vez que alguém precisa dele, espalha verificações de nulo por toda parte e cria a possibilidade de dois caminhos concorrentes criarem dois perfis.

A sessão também fica dentro da transação, e não depois. Se a criação da sessão falhasse fora dela, existiria uma conta criada sem o autologin prometido, e o cadastro pendente já estaria apagado.

A transação vive atrás de um único método da interface `AuthRepository`, `promotePendingSignup`, e é o adaptador Drizzle em `src/db/drizzle-auth-repository.ts` que abre `db.transaction` e executa os quatro passos. O service em `src/plugins/app/auth/verify-code.ts` só decide se a promoção deve acontecer e chama o método uma vez. Colocar a fronteira aí mantém a atomicidade como responsabilidade de quem conhece o banco, e permite ao adaptador em memória dos testes implementar a mesma operação sem simular transação.

### A sessão

* Token de 32 bytes aleatórios em base64url, ou seja 256 bits
* No banco só entra o SHA-256 do token, e o valor em claro existe apenas no cookie
* Tempo de vida de 30 dias, com o mesmo valor na coluna de expiração e no `Max-Age` do cookie, porque divergência entre os dois produz sessão que o navegador considera viva e o servidor recusa
* Rótulo do dispositivo vem do cabeçalho `User-Agent` truncado em 256 caracteres, guardado cru e sem biblioteca de parsing, o suficiente para alguém reconhecer a própria sessão numa lista
* O cookie de cadastro é descartado e o cookie `session` é criado com `HttpOnly`, `Secure`, `SameSite=Strict` e `Path=/`, agora valendo para a API inteira

## Definition of done

* Contrato publicado no OpenAPI, com os três status descritos
* Request e response tipados e validados por schema Zod
* Teste do caminho feliz assertando que a promoção acontece por uma única chamada a `promotePendingSignup`, com usuário criado e cadastro pendente removido no repositório em memória, e que o hash gravado é diferente do token entregue no cookie
* Os quatro passos da transação conferidos no SQL que o adaptador Drizzle gera, já que ele só é coberto por teste de integração
* Teste de código errado verificando incremento do contador e ausência de cookie de sessão
* Teste de cadastro expirado, de excesso de tentativas sem sequer comparar o código, e de cookie ausente
* Teste de formato inválido caindo em 400
* Teste confirmando que o perfil é criado junto do usuário, na mesma transação
