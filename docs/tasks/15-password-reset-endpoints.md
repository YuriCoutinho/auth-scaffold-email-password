# 15. Password reset endpoints

## Introdução

A etapa anterior entregou a troca de senha para quem ainda consegue entrar. Falta o caso oposto, que é o mais comum de todos: a pessoa esqueceu a senha e não tem sessão nenhuma para se apoiar. Sem um caminho de volta, a conta simplesmente morre, e o que existe hoje no lugar de um fluxo de recuperação é o usuário criando uma segunda conta com outro endereço.

Esta etapa entrega dois endpoints. `POST /auth/forgot-password` recebe um endereço de email, registra um pedido de recuperação e envia um código de seis dígitos para a caixa de entrada, devolvendo um cookie que identifica esse pedido. `POST /auth/reset-password` recebe o código e a senha nova, e, quando tudo confere, grava a senha, encerra todas as sessões da conta e abre uma sessão nova para quem acabou de recuperar o acesso.

O fluxo reaproveita o módulo de código do cadastro, que já estava construído e testado, porque o problema é o mesmo: provar que a pessoa controla a caixa de entrada daquele endereço. A diferença é que aqui a conta já existe, e é justamente essa existência que não pode vazar na resposta.

## Requisitos técnicos

### Código de seis dígitos, não link com token

A recuperação por link é o padrão mais difundido, e é o que este projeto não usa. Um link carrega o token na URL, e URL é o lugar mais público que um segredo pode ocupar: fica no histórico do navegador, aparece em log de proxy corporativo e em log de servidor, e vaza pelo cabeçalho `Referer` para qualquer recurso de terceiro que a página de destino carregue. Pior, clientes de email e gateways de segurança abrem links automaticamente para inspecioná-los, o que gasta o token antes de a pessoa clicar e transforma um fluxo correto numa falha intermitente e difícil de diagnosticar.

O código de seis dígitos não tem nenhum desses problemas. Ele não é navegável, não é pré-carregável e não deixa rastro fora da caixa de entrada e do formulário onde é digitado. Como o projeto já usa código de seis dígitos na confirmação do cadastro, a recuperação reaproveita `generateOtpCode` e `hashOtpCode`, e o usuário encontra a mesma interação que já conhece.

### Dois endpoints e nenhum terceiro

Não existe endpoint de reenvio do código de recuperação. Chamar `POST /auth/forgot-password` de novo é o reenvio, e essa é a razão de a gravação ser um upsert em vez de um insert. A chave de `verification_codes` guarda no máximo um código por conta e por finalidade, então a segunda chamada ou mantém o código vivo ou o substitui, conforme o cooldown e o teto de envios, pela mesma regra que o cadastro já usa.

Isso também é o que dispensa um cookie separado para pedir reenvio. O cadastro precisa de `POST /auth/resend-code` porque lá o pendente é identificado pelo cookie e o endereço não volta a ser digitado. Aqui o endereço é o corpo da requisição, então o mesmo endpoint serve para começar e para insistir.

### O código de recuperação é uma linha de `verification_codes`

Não existe tabela nova. O código de recuperação tem exatamente a forma do código de cadastro, com hash do código, hash do token, tentativas, contagem de envios e `issued_at`, então ele é uma linha de `verification_codes` com a finalidade `password_reset`, que entra no enum `verification_purpose` ao lado de `signup`. Uma tabela à parte duplicaria o formato, os métodos da porta e o adaptador em memória, par a par, para guardar a mesma coisa.

A chave `(user_id, purpose)` garante um pedido por conta sem interferir num código de cadastro, e a chave estrangeira com `ON DELETE CASCADE` para `users` faz com que apagar a conta apague o pedido junto.

O código nunca é gravado em claro, e o token também não: as colunas guardam o SHA-256 de cada um. Aqui isso importa ainda mais que no cadastro, porque um token em texto puro somado a um vazamento de leitura da tabela e à inversão trivial do hash de um código de seis dígitos daria a troca de senha de qualquer recuperação em andamento.

A política de TTL ganha `passwordResetCodeSeconds`, com quinze minutos por padrão, e a política dos cookies ganha o cookie deste fluxo. Como o enum faz parte do schema inicial deste scaffold, e não de uma mudança posterior a ele, o baseline em `drizzle/` é regenerado em vez de estendido com uma migration incremental. Não existe banco em produção para migrar, e `drizzle/` guarda um baseline único com o schema inteiro. Essa regra está registrada no `AGENTS.md` e no documento 02.

A limpeza periódica passa a cobrir também estes códigos, com o corte de três vezes o tempo de vida da própria finalidade.

### O cookie `password_reset`

A resposta de `forgot-password` seta o cookie `password_reset` com `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/auth` e `Max-Age` igual ao TTL do código, que é de quinze minutos no padrão. O valor é o token do pedido, e é o hash dele que `reset-password` usa para encontrar a linha, exatamente como `signup_session` faz no cadastro.

O token vive no cookie e não no corpo por um motivo simples: um valor que o cliente nunca precisa ler não deve estar acessível a JavaScript. O `Path=/auth` mantém o cookie longe do resto da API, e o `Max-Age` casado com o TTL faz o cookie morrer junto com o código que ele identifica.

### A resposta é sempre a mesma, exista conta ou não

`POST /auth/forgot-password` responde `202` com uma mensagem fixa e com o cookie setado em todos os casos. Quando o endereço não pertence a conta confirmada nenhuma, seja porque não existe ou porque o cadastro nunca foi confirmado, nada é gravado, nenhum email sai, e o cookie recebe um token descartável, gerado com a mesma função e a mesma entropia do token real. Status, corpo e cabeçalhos são idênticos aos de um endereço conhecido, e o valor do cookie é indistinguível porque em nenhum dos dois casos ele se repete.

Essa última parte é o que obriga o token a rotacionar. O endereço sem conta recebe um valor novo a cada chamada, porque não há nada a guardar. Se o endereço com conta recebesse sempre o token da linha existente, bastariam duas requisições ao mesmo endereço e uma comparação dos dois `Set-Cookie` para saber a resposta: valor repetido quer dizer conta existente, valor diferente quer dizer conta inexistente. Toda a garantia da resposta genérica cairia por causa de um identificador estável. Por isso o token é rotacionado em toda chamada para um endereço com conta, inclusive quando nada é enviado por causa do cooldown ou do teto.

Rotacionar não invalida o código que já está na caixa de entrada, porque a validade dele mora em `code_hash` e no `issued_at` da linha, não no token. O token só identifica qual linha o `reset-password` deve ler, e o cookie que acompanha a resposta é sempre o mais recente. A escrita que rotaciona endereça a linha pela chave `(user_id, purpose)` e grava o hash do token novo no mesmo `UPDATE`, então em nenhum instante existem dois tokens válidos para o mesmo pedido. É o `request` do módulo de código que faz tudo isso, e o service de `forgot-password` só decide se o endereço tem conta confirmada.

O token descartável não abre brecha porque não corresponde a linha nenhuma. Quem o apresentar em `reset-password` recebe o mesmo `401` genérico que um código errado recebe, porque a consulta simplesmente não encontra o pedido.

Do lado de `reset-password`, cookie ausente, cookie desconhecido, pedido expirado, código errado e código esgotado devolvem todos `401` com a mensagem `Invalid or expired code.`. Distinguir esses casos entregaria ao atacante um oráculo para descobrir quais endereços têm conta e em que estado cada pedido está.

### O envio sai do caminho da requisição

Essa é a decisão central desta etapa, e é a que exige mais explicação, porque uma resposta genérica não basta para esconder a existência da conta.

Com a resposta fixa, o que sobra para o atacante medir é o tempo. Quando o endereço tem conta, o servidor grava a linha e fala com o provedor de email antes de responder; quando não tem, responde imediatamente. A diferença é da ordem de centenas de milissegundos e não precisa de nada além de um cronômetro para ser observada. A resposta idêntica esconde o conteúdo e não esconde o custo.

Duas saídas foram consideradas e descartadas. A primeira é acrescentar um atraso aleatório ao caminho rápido. Ruído aleatório não remove a diferença entre as médias, apenas aumenta a variância, então um atacante que repete a medição algumas dezenas de vezes e tira a média recupera a separação intacta. A segunda é impor um piso fixo de tempo a toda resposta. Para funcionar, esse piso precisaria ser maior que o pior caso do provedor, que com a política de duas tentativas deste projeto chega perto de vinte segundos, o que tornaria o endpoint inutilizável para todo mundo em nome de esconder o caso raro.

A saída adotada é tirar o envio da requisição. O módulo de código dispara o envio com `void`, não com `await`, e a resposta sai assim que a linha está gravada. A função de envio converte qualquer exceção em `false` e nunca rejeita, o que é o que torna seguro soltá-lo dessa forma, e a compensação de uma entrega falha roda na continuação, depois da resposta. Com isso o que separa um endereço conhecido de um desconhecido deixa de ser a conversa com o provedor e passa a ser um round-trip de banco mais a geração e o hash do código, ordens de grandeza abaixo do que um cronômetro do outro lado da rede consegue distinguir do ruído.

A compensação é a mesma do cadastro, e aqui fica claro por que ela restaura o estado anterior inteiro em vez de zerar a contagem. Este mesmo endpoint é o reenvio, então zerar seria devolver a cota inteira: uma falha no quarto envio devolveria os cinco. Restaurando o estado capturado antes da escrita, a contagem volta ao valor que tinha. O pedido que nasce agora, seja o primeiro da conta ou o que substitui uma linha expirada, é o único restaurado para uma contagem de zero, porque nele não existe estado anterior e nenhum email chegou de fato.

A rotação obriga as escritas a serem endereçadas pela chave e não pelo token. A escrita que registra um envio novo é um upsert por `(user_id, purpose)`, porque chavear uma escrita pela coluna que ela mesma substitui faz um escritor concorrente casar zero linhas: duas chamadas sobrepostas leem o mesmo token, e a segunda perderia a própria escrita sem que ninguém percebesse, entregando ao chamador um cookie que não aponta para linha alguma. Chaveando pela chave primária, as duas escritas caem na linha, e o estado que fica é o da última. Já a compensação de uma entrega falha endereça pela chave e é guardada pelo `code_hash` do código que falhou, sem tocar no token. Uma restauração que chegue depois de um pedido mais novo ter emitido outro código não escreve nada, e uma que chegue depois de um pedido que só rotacionou o token restaura o código sem matar o cookie mais recente.

O mesmo raciocínio foi aplicado ao que já existia. `POST /auth/signup` deixou de responder `503` quando a entrega falha, e passa a responder `202` com cookie em qualquer caso, com o envio detached e a marcação de não entregue rodando na continuação. O motivo é idêntico: um endereço novo pagava o tempo do provedor enquanto um endereço já confirmado respondia na hora, o que separava os dois casos por cronômetro apesar da resposta genérica. O aviso de senha alterada em `POST /auth/change-password` também saiu do caminho da requisição, aqui não por enumeração, já que a rota exige sessão, mas porque a senha já mudou quando o email sai e não há motivo para o chamador esperar por ele.

`POST /auth/resend-code` continua aguardando a entrega e continua respondendo `503` quando ela falha, de propósito. Para chegar lá é preciso já ter o cookie `signup_session` na mão, então não existe endereço a enumerar, e nesse endpoint a entrega é o produto da chamada: é o único lugar em que dizer ao usuário que o email não saiu é uma informação útil e não um vazamento.

### Teto de cinco tentativas e código esgotado

`reset-password` reaproveita `MAX_CODE_ATTEMPTS`, o mesmo teto de cinco do cadastro. Cada código errado incrementa `code_attempts`, e ao chegar a cinco o código deixa de valer mesmo que o correto apareça em seguida. A verificação do teto acontece antes da comparação, então um código esgotado nunca é comparado. As únicas saídas são pedir outro código, que zera o contador junto com o novo envio, ou esperar o pedido expirar.

Sem esse teto, quinze minutos de validade contra um espaço de um milhão de combinações é um convite a força bruta automatizada.

Os limites que os dois endpoints aplicam são todos por conta: o cooldown de sessenta segundos, o teto de cinco envios por pedido e esse teto de cinco tentativas por código. Limitação por origem é outra camada, vale para a API inteira e não para dois endpoints, e mora na infraestrutura que atende o serviço, não dentro do service.

### A senha nova segue as mesmas regras do resto do projeto

O corpo de `reset-password` é validado por `resetPasswordBodySchema`, com o código sob `/^\d{6}$/` e a senha nova sob a mesma `passwordSchema` usada pelo cadastro e pela troca, que exige de quinze a cento e vinte e oito caracteres e não impõe regra de composição. A senha nova também passa pela consulta ao Have I Been Pwned e é recusada quando aparece em vazamento conhecido, e é recusada quando é igual à senha atual da conta.

A comparação com a senha atual aqui é feita contra o hash guardado, com argon2, e não entre dois valores em claro como na troca de senha, porque neste fluxo a senha atual não é digitada. O hash chega junto com a linha do pedido, que é lida com um join em `users`, o que mantém o fluxo em uma consulta em vez de duas.

### Nenhuma das duas recusas de senha gasta uma tentativa

Quando o código está certo mas a senha nova é igual à atual, ou aparece em vazamento, a resposta é `400` com mensagem própria, o contador de tentativas não é incrementado e a linha do pedido continua de pé. O contador existe para limitar chute de código, e escolher mal a senha não é chute de código. Gastar tentativa nesses casos puniria quem já provou controlar a caixa de entrada e faria a pessoa perder o pedido por tentar duas ou três senhas até achar uma aceita.

A ordem das verificações também importa. O código é conferido antes de qualquer coisa relacionada à senha, e a comparação local com o hash guardado vem antes da consulta ao Have I Been Pwned. Assim quem não tem o código não consegue disparar requisição de saída em nome do serviço, e a chamada externa só acontece quando tudo que é local já passou.

### Todas as sessões caem, na mesma transação

`resetPassword`, na porta `AuthRepository`, roda uma transação só. Primeiro consome o código com um `DELETE` filtrado pelo `token_hash` e pelo `code_hash` que a conferência leu, do mesmo jeito que a confirmação do cadastro; se nada casar, porque outra requisição consumiu o código ou um pedido mais novo o substituiu, a transação devolve falso e a resposta é o mesmo `401`. Depois apaga todas as sessões do usuário, grava o hash da senha nova e cria a sessão do autologin. O encerramento vem antes da criação, deliberadamente: na ordem inversa, a sessão recém-criada seria varrida pelo próprio encerramento e a pessoa sairia do fluxo já deslogada. Um teste fixa exatamente isso, verificando que sobra uma única sessão ao final.

A diferença para a troca de senha é que aqui não existe sessão a preservar. Na troca, a sessão que fez a requisição sobrevive porque quem trocou está presente naquele aparelho. Na recuperação, o ponto de partida é não ter acesso, e o cenário que motiva o fluxo é justamente o de alguém mais estar dentro da conta. Toda sessão anterior é suspeita, então toda sessão anterior cai.

O evento fica no log `password reset`, com o `userId`, separado do `password changed` da troca porque responde a uma pergunta diferente numa investigação: a sessão caiu porque o dono trocou a senha estando dentro, ou porque alguém recuperou a conta de fora.

### Autologin ao final

`reset-password` responde `204`, limpa o cookie `password_reset` e seta o cookie de sessão, deixando a pessoa autenticada. Pedir login logo em seguida seria pedir a senha que ela digitou dez segundos antes, no mesmo formulário, depois de ela já ter provado controlar a caixa de entrada e de o servidor ter acabado de gravar aquela senha. É a mesma decisão que a confirmação do cadastro tomou, pelo mesmo motivo.

### O aviso de senha alterada é reaproveitado

O email de senha alterada, criado na etapa anterior, é enviado também aqui, com o mesmo template e o mesmo helper. Ele passou a ser enviado com `void` nos dois fluxos, e a linha final mudou: antes mandava procurar o suporte, porque não existia caminho de recuperação; agora aponta para a recuperação de senha, que é a ação que de fato devolve a conta a quem a perdeu. O email continua sem link, porque ensinar o leitor a clicar em links dentro de avisos de segurança é o hábito que o phishing explora.

## Definition of done

* `POST /auth/forgot-password` respondendo `202` com mensagem genérica e cookie `password_reset`, e `POST /auth/reset-password` respondendo `204` sem corpo, ambos com o contrato publicado no OpenAPI sob a tag `auth`
* `password_reset` no enum `verification_purpose`, com o código guardado em `verification_codes`, e o baseline de `drizzle/` regenerado aplicando limpo contra um banco vazio
* `passwordResetCodeSeconds` na política de TTL e o cookie `password_reset` em `cookiePolicy`, com o `Max-Age` igual ao TTL
* Endereço sem conta e endereço de cadastro não confirmado recebendo token descartável, sem gravar nada
* Corpos validados por `forgotPasswordBodySchema` e `resetPasswordBodySchema`, com a senha nova sob a mesma `passwordSchema` do cadastro
* Resposta de `forgot-password` idêntica, cookie incluído, para endereço com e sem conta, com teste comparando corpo e status das duas chamadas
* Token do pedido rotacionado em toda chamada para um endereço com conta, inclusive nos ramos de cooldown e de teto atingido, com teste exigindo que o valor do cookie mude entre duas chamadas tanto para endereço conhecido quanto para desconhecido, e teste fixando que os ramos sem envio rotacionam o token sem tocar em nenhum outro campo
* Envio detached com `void` em `forgot-password`, `signup` e no aviso de `change-password`, com teste provando que a resposta não espera o provedor e teste provando que a compensação roda mesmo assim
* Compensação de entrega falha restaurando o estado anterior em vez de zerar a cota, com teste fixando que um envio falho no quarto não devolve os cinco, e sem reescrever o token
* `reset-password` respondendo o mesmo `401` genérico para cookie ausente, cookie desconhecido, pedido expirado, código errado e código esgotado
* Código esgotado permanecendo inutilizável quando o código correto chega depois, coberto por teste
* Recusa por senha repetida e por senha vazada respondendo `400` sem incrementar tentativas e sem apagar o pedido, cobertas por teste
* Encerramento de todas as sessões na mesma transação que consome o código e grava a senha, antes da criação da sessão nova, coberto por teste que verifica uma única sessão ao final
* Código já consumido por uma requisição concorrente respondendo o mesmo `401`
* Cortes de retenção cobrindo os códigos de recuperação com o TTL da própria finalidade
* `POST /auth/signup` sem o `503`, respondendo `202` com cookie também quando a entrega falha
* Nenhum log com senha, código, token ou endereço de email em qualquer um dos fluxos
* `pnpm typecheck`, `pnpm lint`, `pnpm test` e `pnpm build` passando
