# 06. Verify code endpoint

## Introdução

Esta é a etapa que transforma uma tentativa de cadastro em conta de verdade. Ela confirma o código, marca o email da conta como verificado e já deixa a pessoa autenticada, sem pedir que ela faça login logo depois de provar quem é.

O ponto delicado é que várias coisas precisam acontecer juntas: consumir o código, confirmar a conta e abrir a sessão. Se qualquer uma falhar pela metade, sobra estado inconsistente, e o pior deles é um código consumido sem conta confirmada, que trava alguém que fez tudo certo.

A resposta para isso é uma transação só, com a sessão dentro dela. Ou tudo acontece, ou nada acontece e o código continua valendo para uma nova tentativa.

Com o ciclo do cadastro fechado e a primeira sessão criada, esta etapa também liga a limpeza periódica das linhas que deixaram de valer.

## Requisitos técnicos

### Contrato

* `POST /auth/verify-code`, com body `{ code }` validado por `^\d{6}$`
* O endpoint **nunca recebe email**, buscando o código pelo hash do token do cookie. Isso impede que alguém tente o mesmo código contra muitas contas diferentes
* Formato inválido cai no 400 automático da validação, que fala do formato e não revela nada sobre contas
* Sucesso responde `204` sem corpo, com a conta confirmada e o cookie de sessão entregue, porque descrever o usuário logado passou a ser responsabilidade de um endpoint próprio
* Documentado no OpenAPI com os três status possíveis

### Resposta de erro única

Todos os casos de falha respondem o mesmo `401` com a mesma mensagem: cookie ausente, token desconhecido, código expirado, código errado, código invalidado por excesso de tentativas e código já consumido por uma requisição concorrente. Mensagens diferentes para cada caso pareceriam mais gentis, mas entregariam um oráculo para descobrir quais cadastros existem e em que estado estão.

A distinção que a resposta não faz fica no log, que é interno e não alimenta oráculo nenhum: token desconhecido e código expirado produzem registros diferentes, o segundo com o id da conta, de modo que uma sessão de cadastro morta não seja lida depois como tentativa de adivinhar código.

### A conferência mora no módulo de código

A conferência é o `verify` de `src/plugins/app/auth/verification-codes.ts`, o mesmo módulo que emite e reenvia, parametrizado pela finalidade. Ele busca o código pelo hash do token, confere a validade por `issued_at` mais o tempo de vida do código, aplica o limite de tentativas, compara o hash e devolve o registro lido. Ele **não consome** o código: o consumo pertence à transação do fluxo que age sobre ele, porque é ali que ele precisa ser atômico com o resto.

### Limite de tentativas

* Máximo de 5 tentativas erradas por código, `MAX_CODE_ATTEMPTS`
* A checagem do limite acontece **antes** de comparar o código. Assim o código esgotado fica inutilizável mesmo que o valor certo apareça depois, e isso se consegue sem coluna nova, apenas pela ordem das verificações
* Cada tentativa errada incrementa o contador direto no SQL, somando sobre o valor da coluna em vez de ler, somar e gravar, porque a segunda forma perde incrementos sob concorrência
* A saída do estado esgotado é pedir um código novo, que zera o contador, ou esperar a expiração
* Toda tentativa falha vira log, com o id da conta e a contagem, nunca com o código. Atingir o limite também é logado, porque é o insumo para detectar padrão de ataque depois

### A transação de confirmação

Com o código correto, uma única transação executa três passos:

1. `DELETE` do código filtrando por conta, finalidade, `token_hash` e `code_hash` iguais aos que a conferência leu, com `RETURNING`
2. `UPDATE` em `users` gravando `email_verified_at`, filtrado por `email_verified_at IS NULL`
3. `INSERT` em `sessions` com o id gerado pela aplicação, o hash do token, o rótulo do dispositivo e o instante de criação

Consumir primeiro faz da linha do código o ponto de serialização. Uma segunda requisição com o mesmo código bloqueia nesse `DELETE` e, quando a primeira confirma, casa zero linhas. O mesmo vale para um cadastro concorrente que rotacionou o token ou emitiu outro código entre a leitura e a escrita: os hashes lidos já não batem, nada é consumido e a confirmação perde a corrida em vez de confirmar a senha que um cadastro mais novo acabou de trocar. Em qualquer desses casos a transação devolve falso, e o service responde o mesmo `401`.

O filtro `email_verified_at IS NULL` é defensivo. Se uma conta já confirmada ainda tivesse um código de cadastro sobrando, o `UPDATE` casaria zero linhas e a transação seria desfeita, porque um código de cadastro nunca pode virar sessão sem senha numa conta que já existe.

Não existe mais nada a mover. A conta pendente e a conta confirmada são a mesma linha, com o mesmo id e a mesma senha, então confirmar é marcar um instante e não copiar dados entre tabelas.

A sessão fica dentro da transação, e não depois. Se a criação da sessão falhasse fora dela, existiria uma conta confirmada sem o autologin prometido, e o código já estaria consumido.

A transação vive atrás de um único método da interface `AuthRepository`, `verifyEmail`, e é o adaptador Drizzle em `src/plugins/app/auth/drizzle-repository.ts` que abre `db.transaction` e executa os três passos. O passo da sessão não é escrito ali: o adaptador de auth chama `createDrizzleSessionRepository(tx)` e pede a inserção à fatia de sessão, passando a própria transação. É assim que o SQL da tabela `sessions` fica num lugar só, dentro de `src/plugins/app/sessions/`, sem que a atomicidade do autologin se perca. O service em `src/plugins/app/auth/verify-code.ts` só chama a conferência e, com o código válido, chama o método uma vez. Colocar a fronteira aí mantém a atomicidade como responsabilidade de quem conhece o banco, e permite ao adaptador em memória dos testes implementar a mesma operação sem simular transação.

### A sessão

* Token de 32 bytes aleatórios em base64url, ou seja 256 bits
* No banco só entra o SHA-256 do token, e o valor em claro existe apenas no cookie
* Tempo de vida de 30 dias por padrão, `sessionSeconds` da política de TTL. A tabela guarda só `created_at`, e a validade é esse instante mais o tempo de vida, calculada na leitura. O `Max-Age` do cookie sai do mesmo valor por `cookiePolicy`, porque divergência entre os dois produz sessão que o navegador considera viva e o servidor recusa
* Rótulo do dispositivo vem do cabeçalho `User-Agent` truncado em 256 caracteres, guardado cru e sem biblioteca de parsing, o suficiente para alguém reconhecer a própria sessão numa lista
* O cookie de cadastro é descartado e o cookie `session` é criado com `HttpOnly`, `Secure`, `SameSite=Strict` e `Path=/`, agora valendo para a API inteira

### A limpeza periódica

Nada no fluxo apaga um código que expirou sem uso, uma conta cujo dono nunca confirmou ou uma sessão que venceu sem logout. As linhas já não valem, porque a validade é calculada na leitura, mas continuam ocupando espaço para sempre. O plugin `src/plugins/app/retention/` resolve isso com uma varredura periódica.

* A porta `RetentionRepository` tem um método só, `purge(cutoffs)`, que recebe os cortes e devolve quantas linhas apagou de cada tipo. O adaptador Drizzle fica ao lado, e `AppOptions.retentionRepository` permite trocá-lo em teste
* Os cortes são calculados por `retentionCutoffs(ttl, now)`, uma função pura em `src/lib/retention.ts`, a partir da mesma política de TTL que os fluxos usam
* Sessão é apagada um dia depois de vencer. A sessão já está morta no instante em que vence, e o dia a mais só existe para que a varredura não dispute com uma requisição que leu a linha um instante antes
* Código é apagado quando passou de três vezes o tempo de vida da própria finalidade. Ele parou de funcionar no fim do tempo de vida, independentemente da limpeza, então o multiplicador não decide validade, decide só por quanto tempo o rastro de uma tentativa recente continua disponível para diagnóstico
* Conta não confirmada é apagada quando foi criada há mais de três vezes o tempo de vida do código de cadastro **e** não tem mais nenhuma linha em `verification_codes`. Por isso a ordem importa: primeiro saem os códigos velhos, depois as contas. O critério por ausência de código é o que impede a varredura de apagar uma conta no meio de um cadastro, porque um novo cadastro renova o código e não o `created_at` da conta, e olhar só para o `created_at` apagaria justamente quem acabou de tentar de novo
* O intervalo é de uma hora, `RETENTION_INTERVAL_SECONDS`. O timer é um `setInterval` com `unref`, para que uma varredura pendente nunca seja o que mantém o processo vivo, e é limpo no `onClose`
* A varredura nunca rejeita. Uma falha vira log de erro e a próxima rodada tenta de novo, porque uma rejeição não tratada vinda de um timer derrubaria o processo. Uma varredura bem-sucedida loga as contagens
* Cada instância roda o próprio timer, sem coordenação. A varredura é um conjunto de `DELETE` idempotentes, então duas instâncias rodando juntas custam um pouco de trabalho repetido e nada mais
* Os índices sobre `issued_at`, `users.created_at` e `sessions.created_at`, criados na modelagem, são o que mantém essas consultas baratas

## Definition of done

* Contrato publicado no OpenAPI, com os três status descritos
* Request e response tipados e validados por schema Zod
* Teste do caminho feliz assertando que a confirmação acontece por uma única chamada a `verifyEmail`, com a conta confirmada e o código removido no repositório em memória, e que o hash gravado é diferente do token entregue no cookie
* Os três passos da transação conferidos no SQL que o adaptador Drizzle gera, já que ele só é coberto por teste de integração
* Teste de código errado verificando incremento do contador e ausência de cookie de sessão
* Teste de código expirado, de excesso de tentativas sem sequer comparar o código, e de cookie ausente
* Teste de confirmação contra um token rotacionado por um cadastro concorrente perdendo a corrida com `401`
* Teste provando que um código de cadastro de conta já confirmada não cria sessão
* Teste de formato inválido caindo em 400
* Teste dos cortes de retenção e da varredura, cobrindo a carência de um dia da sessão, o multiplicador dos códigos e das contas não confirmadas, e a varredura que falha sem rejeitar
