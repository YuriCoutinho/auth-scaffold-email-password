# 15. Password reset endpoints

## Introdução

A etapa anterior entregou a troca de senha para quem ainda consegue entrar. Falta o caso oposto, que é o mais comum de todos: a pessoa esqueceu a senha e não tem sessão nenhuma para se apoiar. Sem um caminho de volta, a conta simplesmente morre, e o que existe hoje no lugar de um fluxo de recuperação é o usuário criando uma segunda conta com outro endereço.

Esta etapa entrega dois endpoints. `POST /auth/forgot-password` recebe um endereço de email, registra um pedido de recuperação e envia um código de seis dígitos para a caixa de entrada, devolvendo um cookie que identifica esse pedido. `POST /auth/reset-password` recebe o código e a senha nova, e, quando tudo confere, grava a senha, revoga todas as sessões da conta e abre uma sessão nova para quem acabou de recuperar o acesso.

O fluxo espelha o cadastro, que já estava construído e testado, porque o problema é o mesmo: provar que a pessoa controla a caixa de entrada daquele endereço. A diferença é que aqui a conta já existe, e é justamente essa existência que não pode vazar na resposta.

## Requisitos técnicos

### Código de seis dígitos, não link com token

A recuperação por link é o padrão mais difundido, e é o que este projeto não usa. Um link carrega o token na URL, e URL é o lugar mais público que um segredo pode ocupar: fica no histórico do navegador, aparece em log de proxy corporativo e em log de servidor, e vaza pelo cabeçalho `Referer` para qualquer recurso de terceiro que a página de destino carregue. Pior, clientes de email e gateways de segurança abrem links automaticamente para inspecioná-los, o que gasta o token antes de a pessoa clicar e transforma um fluxo correto numa falha intermitente e difícil de diagnosticar.

O código de seis dígitos não tem nenhum desses problemas. Ele não é navegável, não é pré-carregável e não deixa rastro fora da caixa de entrada e do formulário onde é digitado. Como o projeto já usa código de seis dígitos na confirmação do cadastro, a recuperação reaproveita `generateOtpCode` e `hashOtpCode`, e o usuário encontra a mesma interação que já conhece.

### Dois endpoints e nenhum terceiro

Não existe endpoint de reenvio do código de recuperação. Chamar `POST /auth/forgot-password` de novo é o reenvio, e essa é a razão de o endpoint ser um upsert em vez de um insert. A tabela guarda no máximo um pedido por usuário, então a segunda chamada ou reaproveita o pedido vivo ou o substitui, conforme o cooldown e o teto de envios.

Isso também é o que dispensa um cookie separado para pedir reenvio. O cadastro precisa de `POST /auth/resend-code` porque lá o pendente é identificado pelo cookie e o endereço não volta a ser digitado. Aqui o endereço é o corpo da requisição, então o mesmo endpoint serve para começar e para insistir.

### A tabela `password_resets`

A tabela nova segue a forma de `pending_signups`, com `code_hash`, `code_attempts`, `last_sent_at`, `code_send_count`, `expires_at` e o token de sessão do fluxo, mas a chave é outra. O cadastro pendente é chaveado por email porque a conta ainda não existe. A recuperação é chaveada por `user_id`, porque a conta existe e o pedido pertence a ela. A coluna é `UNIQUE`, o que garante um pedido por conta e dá ao upsert o alvo de conflito, e tem `ON DELETE CASCADE` para `auth_users`, de modo que apagar a conta apaga o pedido junto.

O código nunca é gravado em claro: a coluna guarda o SHA-256 dele, pela mesma razão que o código de cadastro guarda. Um dump da tabela não entrega nenhum código utilizável.

Como `password_resets` faz parte do schema inicial deste scaffold, e não de uma mudança posterior a ele, o baseline em `drizzle/` é regenerado em vez de estendido com uma migration incremental. Não existe banco em produção para migrar, e `drizzle/` guarda um baseline único com o schema inteiro. Essa regra está registrada no `AGENTS.md` e no documento 02.

### O cookie `password_reset`

A resposta de `forgot-password` seta o cookie `password_reset` com `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/auth` e `Max-Age` igual ao TTL do código, que é de quinze minutos. O valor é o token do pedido, e é ele que `reset-password` usa para encontrar a linha, exatamente como `signup_session` faz no cadastro.

O token vive no cookie e não no corpo por um motivo simples: um valor que o cliente nunca precisa ler não deve estar acessível a JavaScript. O `Path=/auth` mantém o cookie longe do resto da API, e o `Max-Age` casado com o TTL faz o cookie morrer junto com o código que ele identifica.

### A resposta é sempre a mesma, exista conta ou não

`POST /auth/forgot-password` responde `202` com uma mensagem fixa e com o cookie setado em todos os casos. Quando o endereço não pertence a conta nenhuma, nada é gravado, nenhum email sai, e o cookie recebe um token descartável, gerado com a mesma função e a mesma entropia do token real. Status, corpo e cabeçalhos são idênticos aos de um endereço conhecido, e o valor do cookie é indistinguível porque em nenhum dos dois casos ele se repete.

Essa última parte é o que obriga o token a rotacionar. O endereço sem conta recebe um valor novo a cada chamada, porque não há nada a guardar. Se o endereço com conta recebesse sempre o token da linha existente, bastariam duas requisições ao mesmo endereço e uma comparação dos dois `Set-Cookie` para saber a resposta: valor repetido quer dizer conta existente, valor diferente quer dizer conta inexistente. Toda a garantia da resposta genérica cairia por causa de um identificador estável. Por isso o token é rotacionado em toda chamada para um endereço com conta, inclusive quando nada é enviado por causa do cooldown ou do teto.

Rotacionar não invalida o código que já está na caixa de entrada, porque a validade dele mora em `code_hash` e no `expires_at` da linha, não no token. O token só identifica qual linha o `reset-password` deve ler, e o cookie que acompanha a resposta é sempre o mais recente. A escrita que rotaciona endereça a linha pelo token antigo e grava o novo no mesmo `UPDATE`, então em nenhum instante existem dois tokens válidos para o mesmo pedido.

O token descartável não abre brecha porque não corresponde a linha nenhuma. Quem o apresentar em `reset-password` recebe o mesmo `401` genérico que um código errado recebe, porque a consulta simplesmente não encontra o pedido.

Do lado de `reset-password`, cookie ausente, cookie desconhecido, pedido expirado, código errado e código esgotado devolvem todos `401` com a mensagem `Invalid or expired code.`. Distinguir esses casos entregaria ao atacante um oráculo para descobrir quais endereços têm conta e em que estado cada pedido está.

### O envio sai do caminho da requisição

Essa é a decisão central desta etapa, e é a que exige mais explicação, porque uma resposta genérica não basta para esconder a existência da conta.

Com a resposta fixa, o que sobra para o atacante medir é o tempo. Quando o endereço tem conta, o servidor grava a linha e fala com o provedor de email antes de responder; quando não tem, responde imediatamente. A diferença é da ordem de centenas de milissegundos e não precisa de nada além de um cronômetro para ser observada. A resposta idêntica esconde o conteúdo e não esconde o custo.

Duas saídas foram consideradas e descartadas. A primeira é acrescentar um atraso aleatório ao caminho rápido. Ruído aleatório não remove a diferença entre as médias, apenas aumenta a variância, então um atacante que repete a medição algumas dezenas de vezes e tira a média recupera a separação intacta. A segunda é impor um piso fixo de tempo a toda resposta. Para funcionar, esse piso precisaria ser maior que o pior caso do provedor, que com a política de duas tentativas deste projeto chega perto de vinte segundos, o que tornaria o endpoint inutilizável para todo mundo em nome de esconder o caso raro.

A saída adotada é tirar o envio da requisição. `sendPasswordResetCode` é chamado com `void`, não com `await`, e a resposta sai assim que a linha está gravada. O helper converte qualquer exceção em `false` e nunca rejeita, o que é o que torna seguro soltá-lo dessa forma, e a compensação de uma entrega falha roda na continuação, depois da resposta. Com isso, endereço conhecido e endereço desconhecido custam o mesmo, porque a única diferença de trabalho que sobra é uma escrita local.

Essa compensação tem uma particularidade em relação ao cadastro. Lá, uma entrega falha zera `code_send_count`, e zero significa "nenhum email foi entregue para o código atual". Aqui zerar seria devolver a cota inteira, porque este mesmo endpoint é o reenvio: uma falha no quarto envio devolveria os cinco. Por isso a compensação restaura o estado anterior inteiro, capturado antes da escrita, o que devolve a contagem ao valor que ela tinha, e não a zero. O pedido que nasce agora, seja o primeiro da conta ou o que substitui uma linha expirada, é o único restaurado para uma contagem de zero, porque nele não existe estado anterior e nenhum email chegou de fato.

A rotação do token também resolve, de graça, um risco que a compensação tardia traria. Como ela roda depois da resposta, uma segunda chamada pode acontecer antes dela e sobrescrever um estado mais novo com um mais velho. Isso deixa de ser possível porque a compensação escreve endereçando a linha pelo token da chamada que a originou, e a chamada seguinte já substituiu esse token, então a escrita atrasada não encontra linha alguma e vira um no-op.

O mesmo raciocínio foi aplicado ao que já existia. `POST /auth/signup` deixou de responder `503` quando a entrega falha, e passa a responder `202` com cookie em qualquer caso, com o envio detached e a marcação de não entregue rodando na continuação. O motivo é idêntico: um endereço novo pagava o tempo do provedor enquanto um endereço já confirmado respondia na hora, o que separava os dois casos por cronômetro apesar da resposta genérica. O aviso de senha alterada em `POST /auth/change-password` também saiu do caminho da requisição, aqui não por enumeração, já que a rota exige sessão, mas porque a senha já mudou quando o email sai e não há motivo para o chamador esperar por ele.

`POST /auth/resend-code` continua aguardando a entrega e continua respondendo `503` quando ela falha, de propósito. Para chegar lá é preciso já ter o cookie `signup_session` na mão, então não existe endereço a enumerar, e nesse endpoint a entrega é o produto da chamada: é o único lugar em que dizer ao usuário que o email não saiu é uma informação útil e não um vazamento.

### Teto de cinco tentativas e código esgotado

`reset-password` reaproveita `MAX_CODE_ATTEMPTS`, o mesmo teto de cinco do cadastro. Cada código errado incrementa `code_attempts`, e ao chegar a cinco o código deixa de valer mesmo que o correto apareça em seguida. A verificação do teto acontece antes da comparação, então um código esgotado nunca é comparado. As únicas saídas são pedir outro código, que zera o contador junto com o novo envio, ou esperar o pedido expirar.

Sem esse teto, quinze minutos de validade contra um espaço de um milhão de combinações é um convite a força bruta automatizada.

### A senha nova segue as mesmas regras do resto do projeto

O corpo de `reset-password` é validado por `resetPasswordBodySchema`, com o código sob `/^\d{6}$/` e a senha nova sob a mesma `passwordSchema` usada pelo cadastro e pela troca, que exige de quinze a cento e vinte e oito caracteres e não impõe regra de composição. A senha nova também passa pela consulta ao Have I Been Pwned e é recusada quando aparece em vazamento conhecido, e é recusada quando é igual à senha atual da conta.

A comparação com a senha atual aqui é feita contra o hash guardado, com argon2, e não entre dois valores em claro como na troca de senha, porque neste fluxo a senha atual não é digitada. O hash chega junto com a linha do pedido, que é lida com um join em `auth_users`, o que mantém o fluxo em uma consulta em vez de duas.

### Nenhuma das duas recusas de senha gasta uma tentativa

Quando o código está certo mas a senha nova é igual à atual, ou aparece em vazamento, a resposta é `400` com mensagem própria, o contador de tentativas não é incrementado e a linha do pedido continua de pé. O contador existe para limitar chute de código, e escolher mal a senha não é chute de código. Gastar tentativa nesses casos puniria quem já provou controlar a caixa de entrada e faria a pessoa perder o pedido por tentar duas ou três senhas até achar uma aceita.

A ordem das verificações também importa. O código é conferido antes de qualquer coisa relacionada à senha, e a comparação local com o hash guardado vem antes da consulta ao Have I Been Pwned. Assim quem não tem o código não consegue disparar requisição de saída em nome do serviço, e a chamada externa só acontece quando tudo que é local já passou.

### Todas as sessões caem, na mesma transação

`resetUserPassword` roda uma transação só, que revoga todas as sessões do usuário com o motivo novo `password_reset`, grava o hash da senha nova, apaga a linha do pedido e cria a sessão do autologin. A revogação vem antes da criação, deliberadamente: na ordem inversa, a sessão recém-criada seria varrida pela própria revogação e a pessoa sairia do fluxo já deslogada. Um teste fixa exatamente isso, verificando que sobra uma única sessão ativa ao final.

A diferença para a troca de senha é que aqui não existe sessão a preservar. Na troca, a sessão que fez a requisição sobrevive porque quem trocou está presente naquele aparelho. Na recuperação, o ponto de partida é não ter acesso, e o cenário que motiva o fluxo é justamente o de alguém mais estar dentro da conta. Toda sessão anterior é suspeita, então toda sessão anterior cai.

O motivo `password_reset` entra em `REVOKED_REASONS` ao lado de `password_changed`, separado dele porque responde a uma pergunta diferente na auditoria: a sessão caiu porque o dono trocou a senha estando dentro, ou porque alguém recuperou a conta de fora.

### Autologin ao final

`reset-password` responde `204`, limpa o cookie `password_reset` e seta o cookie de sessão, deixando a pessoa autenticada. Pedir login logo em seguida seria pedir a senha que ela digitou dez segundos antes, no mesmo formulário, depois de ela já ter provado controlar a caixa de entrada e de o servidor ter acabado de gravar aquela senha. É a mesma decisão que a confirmação do cadastro tomou, pelo mesmo motivo.

### O aviso de senha alterada é reaproveitado

O email de senha alterada, criado na etapa anterior, é enviado também aqui, com o mesmo template e o mesmo helper. Ele passou a ser enviado com `void` nos dois fluxos, e a linha final mudou: antes mandava procurar o suporte, porque não existia caminho de recuperação; agora aponta para a recuperação de senha, que é a ação que de fato devolve a conta a quem a perdeu. O email continua sem link, porque ensinar o leitor a clicar em links dentro de avisos de segurança é o hábito que o phishing explora.

### Limite de taxa fica fora do escopo

Nem `forgot-password` nem `reset-password` ganham limitação por IP nesta etapa. O que protege os dois hoje é o cooldown de sessenta segundos, o teto de cinco envios por pedido e o teto de cinco tentativas por código, todos por conta. Limitação por origem é uma preocupação de infraestrutura que vale para a API inteira e não para dois endpoints, e resolvê-la aqui, de forma parcial e em memória, seria resolver o problema no lugar errado.

## Definition of done

* `POST /auth/forgot-password` respondendo `202` com mensagem genérica e cookie `password_reset`, e `POST /auth/reset-password` respondendo `204` sem corpo, ambos com o contrato publicado no OpenAPI sob a tag `auth`
* Tabela `password_resets` no schema Drizzle, chaveada por `user_id` com `UNIQUE` e `ON DELETE CASCADE`, com índice em `expires_at`, e o baseline de `drizzle/` regenerado aplicando limpo contra um banco vazio
* Corpos validados por `forgotPasswordBodySchema` e `resetPasswordBodySchema`, com a senha nova sob a mesma `passwordSchema` do cadastro
* Resposta de `forgot-password` idêntica, cookie incluído, para endereço com e sem conta, com teste comparando corpo e status das duas chamadas
* Token do pedido rotacionado em toda chamada para um endereço com conta, inclusive nos ramos de cooldown e de teto atingido, com teste exigindo que o valor do cookie mude entre duas chamadas tanto para endereço conhecido quanto para desconhecido, e teste fixando que os ramos sem envio rotacionam o token sem tocar em nenhum outro campo
* Envio detached com `void` em `forgot-password`, `signup` e no aviso de `change-password`, com teste provando que a resposta não espera o provedor e teste provando que a compensação roda mesmo assim
* Compensação de entrega falha restaurando o estado anterior em vez de zerar a cota, com teste fixando que um envio falho no quarto não devolve os cinco
* `reset-password` respondendo o mesmo `401` genérico para cookie ausente, cookie desconhecido, pedido expirado, código errado e código esgotado
* Código esgotado permanecendo inutilizável quando o código correto chega depois, coberto por teste
* Recusa por senha repetida e por senha vazada respondendo `400` sem incrementar tentativas e sem apagar o pedido, cobertas por teste
* Revogação de todas as sessões com o motivo `password_reset` na mesma transação da gravação da senha, com a revogação antes da criação da sessão nova, coberta por teste que verifica uma única sessão ativa ao final
* `POST /auth/signup` sem o `503`, respondendo `202` com cookie também quando a entrega falha
* Nenhum log com senha, código, token ou endereço de email em qualquer um dos fluxos
* `pnpm typecheck`, `pnpm lint`, `pnpm test` e `pnpm build` passando
