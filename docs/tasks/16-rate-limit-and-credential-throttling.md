# 16. Rate limit and credential throttling

## Introdução

Até aqui a API tratava cada requisição como um evento isolado. O login confere as credenciais em tempo constante, o cadastro responde de forma genérica para não revelar quais emails existem, a confirmação por código tem teto de tentativas e o reenvio tem cooldown. Nenhuma dessas proteções, porém, olha para o volume. Um script que dispare dez mil requisições por minuto contra `POST /auth/login` passa por todas elas sem tropeçar em nada, porque cada requisição, vista sozinha, é legítima. O que a torna um ataque é a repetição.

Esta etapa fecha essa lacuna com duas camadas independentes. A primeira é um bloqueio progressivo por email, que conta falhas consecutivas de credencial e compra tempo a cada rodada de erros, guardado no Postgres. A segunda é um limite de requisições por IP, aplicado a toda rota da API e ajustado por rota, fornecido pelo plugin oficial `@fastify/rate-limit`.

As duas camadas respondem a ataques diferentes e por isso convivem sem se substituir. O limite por IP contém o volume vindo de uma origem, mas um atacante com uma botnet distribui as tentativas por milhares de endereços e cada um deles fica confortavelmente abaixo do teto. O bloqueio por email não se importa com a origem: ele conta as falhas contra uma conta, venham de onde vierem, e é o que sobrevive à distribuição. Na direção oposta, o bloqueio por email nada faz contra um varredor que só quer mapear rotas ou queimar quota de serviço externo, e é o limite por IP que o segura.

## Requisitos técnicos

### Cada camada mora onde a natureza dela pede

O bloqueio progressivo é política de negócio e o estado dele precisa sobreviver a um restart. Um atacante que descobrisse que o contador some quando o processo reinicia teria uma forma barata de zerar o bloqueio, e mesmo sem atacante um deploy no meio de uma tentativa de invasão apagaria exatamente o que se queria lembrar. Por isso ele vira uma fatia própria, `src/plugins/app/credential-throttle/`, com porta em `repository.ts`, adaptador Drizzle em `drizzle-repository.ts`, os fluxos em `create-credential-throttle.ts` e o decorator `fastify.credentialThrottle` no `index.ts`. É o mesmo desenho que a fatia `sessions/` já usa, e ele é o que permite que o teste troque o adaptador por um em memória sem banco e sem rede.

O limite por IP é infraestrutura e o estado dele é descartável. Um contador de requisições por minuto não precisa atravessar um restart, porque a janela que ele guarda expira em segundos de qualquer forma. Ele entra como `src/plugins/external/rate-limit.ts`, um arquivo por pacote de terceiro, com o store em memória que o plugin traz por padrão.

Escrever os contadores por IP no Postgres foi considerado e recusado. Seria uma escrita no banco por tentativa, inclusive pelas tentativas que estão prestes a ser rejeitadas, o que transformaria o limitador num amplificador do ataque que ele existe para conter. O primeiro recurso a acabar sob uma enxurrada seria a conexão com o banco, e aí o serviço inteiro cai, não só a rota atacada.

### A curva do bloqueio dá três erros de graça e depois cresce cinco vezes por rodada

`src/lib/throttle.ts` guarda a curva como função pura. As três primeiras falhas consecutivas não abrem bloqueio nenhum, porque digitar a senha errada é comportamento humano comum e punir a terceira tentativa de quem só trocou o layout do teclado transforma segurança em atrito. A partir da quarta, a janela abre em um minuto e se multiplica por cinco a cada nova falha, chegando a cinco minutos, depois vinte e cinco, até o teto de uma hora.

O teto existe para que o bloqueio não vire negação de serviço contra o dono da conta. Sem ele, um atacante que conheça o email de alguém erra a senha vinte vezes de propósito e deixa a vítima trancada por semanas. Com o teto de uma hora, o custo para o atacante continua proibitivo, porque uma hora por tentativa inviabiliza qualquer varredura de dicionário, e o prejuízo máximo para quem é alvo é uma espera limitada.

O mesmo valor do teto governa o descarte por inatividade. Se a última falha registrada é mais antiga que uma hora, a contagem recomeça do um em vez de continuar de onde parou. Sem essa regra, uma linha esquecida com sete falhas de dois dias atrás faria o próximo erro de digitação do usuário cair direto num bloqueio de uma hora, quando na prática não existe rajada nenhuma acontecendo. O que caracteriza a máquina é a sequência, e uma sequência interrompida por uma hora deixou de ser sequência.

### A linha é chaveada por um hash do email, e conta também endereços sem conta

A tabela `credential_throttle` guarda `key_hash`, e não o endereço. A linha existe para contar abuso, e uma tabela sobre abuso não tem por que carregar um email em repouso. O digest é o mesmo SHA-256 já usado para código de confirmação e token de sessão, exposto como `hashThrottleKey` em `src/lib/token-hash.ts`, porque a proteção aqui não vem do custo do hash e sim do fato de o valor não ser recuperável a olho nu num dump.

O contador incrementa mesmo quando o email não pertence a conta nenhuma. Se só endereços existentes fossem contados, o bloqueio viraria o oráculo de enumeração que o resto do fluxo se esforça para não ser: bastaria errar a senha quatro vezes e observar se o quinto pedido devolve `429` ou o `401` de sempre para descobrir se a conta existe. Contando todo mundo, a resposta é idêntica nos dois casos, e um teste de rota fixa justamente isso com um email que não existe.

A mesma preocupação vale para o log. Quando um bloqueio abre, o registro leva a quantidade de falhas e o instante em que o bloqueio termina, e nunca o email nem o hash dele. Um digest estável é um identificador tão útil quanto o endereço para seguir uma pessoa de evento em evento, então ele fica fora do log pelo mesmo motivo pelo qual o email fica.

### Login e troca de senha compartilham o mesmo espaço de chaves

O `login` normaliza o endereço recebido com `trim().toLowerCase()` antes de qualquer coisa, e é esse valor normalizado que vira a chave. O `change-password` não recebe email nenhum, porque o chamador já está autenticado, então ele lê o endereço guardado do usuário e usa esse valor.

As duas rotas precisam produzir a mesma chave. Se produzissem chaves diferentes, um atacante que tivesse roubado um cookie alternaria entre os dois endpoints e ganharia dois orçamentos de tentativas grátis em vez de um. Como o endereço só entra na tabela de usuários já normalizado, os dois caminhos convergem, e um teste de serviço fixa que uma falha vinda da troca de senha é registrada sob o mesmo endereço que o login usaria.

### A consulta ao bloqueio vem antes da verificação argon2

Em ambos os serviços, a checagem do bloqueio acontece antes da chamada a `verifyPassword`. O argon2 é caro por desenho, e é justamente esse custo que faz dele uma boa função de senha. Deixar a verificação rodar para um chamador que já está bloqueado significa gastar CPU do servidor a pedido de quem está atacando, ou seja, entregar ao atacante exatamente o recurso que o bloqueio deveria proteger.

No `change-password` a leitura do usuário precisa vir primeiro, porque é dela que sai a chave, mas a checagem se encaixa entre essa leitura e a verificação da senha. A ordem é frágil a refatorações, já que mover a checagem para depois da verificação deixa todos os outros testes passando enquanto remove a proteção em silêncio, e por isso os dois serviços têm um teste que afirma que `verifyPassword` não foi chamado num caminho bloqueado.

Uma autenticação bem-sucedida apaga a linha. O que se está contando é uma rajada de falhas, e um acerto no meio dela encerra a rajada. Uma recuperação de senha concluída apaga a linha pelo mesmo motivo, e `POST /auth/reset-password` chama o `reset` no caminho de sucesso, logo depois de gravar a senha nova. Provar posse do email vale mais que a contagem de falhas, porque quem recebeu o código na caixa de entrada demonstrou algo mais forte do que acertar a senha. Sem essa limpeza o efeito cairia justamente sobre o usuário legítimo: ele erra a senha quatro vezes, toma o bloqueio, pede a recuperação, define a senha nova e mesmo assim continua trancado do lado de fora por um contador que já perdeu o sentido.

### O bloqueio responde `429` com `Retry-After`, e não o `401` genérico

As rotas de autenticação respondem de forma genérica de propósito, e o `401` do login é idêntico quando o email é desconhecido e quando a senha está errada. O `429` não quebra esse princípio, porque ele não fala sobre a credencial, fala sobre o ritmo do chamador. A informação que ele revela, de que houve tentativas demais contra aquela chave, é informação que o próprio chamador produziu.

Usar `401` aqui seria pior em todos os aspectos. O cliente legítimo não teria como distinguir uma senha errada de um bloqueio temporário e insistiria imediatamente, alimentando o contador que acabou de fechar contra ele, e a tela não teria o que dizer ao usuário além de repetir que as credenciais estão incorretas, o que não é verdade. O `429` é o código que a especificação reserva para esse caso e é o que os clientes HTTP já sabem interpretar.

O cabeçalho `Retry-After` acompanha a resposta com o número de segundos restantes. O cálculo usa arredondamento para cima, nunca para baixo: um resto de quatro décimos de segundo ainda é uma espera devida, e arredondar para baixo produziria `0`, que manda o cliente tentar de novo na hora. Um valor fracionário também não é um cabeçalho válido. Um teste de serviço fixa o caso do resto abaixo de um segundo esperando `1`.

### O limite por IP é global e depois estreitado por rota

`src/plugins/external/rate-limit.ts` registra o plugin com `global: true` e o teto geral de cem requisições por minuto, e cada rota de autenticação declara o próprio teto em `config.rateLimit`. As políticas ficam em `src/lib/rate-limit.ts`, como constantes puras acompanhadas de `rateLimitFor`, que resolve o escopo pedido caindo no valor de produção quando não há sobreposição.

A escolha de janela segue o custo do abuso. Onde o ataque é força bruta, a janela é por minuto, porque o que se quer limitar é a cadência. Onde cada chamada dispara um email de saída, a janela é por hora, porque o recurso escasso ali é a reputação do remetente e a quota do provedor, e vinte cadastros por hora vindos do mesmo IP já é mais do que qualquer uso legítimo. As rotas que conferem código ficam mais folgadas de propósito, porque o controle real delas é o teto de tentativas por cadastro que já existe no fluxo, e não o limite por IP.

O handler de rota não encontrada também passa pelo limitador e responde no formato de erro do projeto, `{ "message": "Not Found." }`. Sem isso, um varredor de rotas procurando endpoints esquecidos operaria fora de qualquer limite, já que nenhuma rota registrada seria atingida por ele.

Registrar o plugin globalmente mexe em toda resposta da API, então dois comportamentos existentes ficam presos por teste: o `204` continua sem corpo, e o `404` continua com o formato que o `error-handler` normaliza.

Nos testes o limitador roda exatamente como roda em produção, e apenas o teto se move. `tests/helpers/app-options.ts` ajusta todos os escopos para um valor alto o bastante para que nenhum teste existente esbarre neles, e o teste que quer ver o `429` abaixa o teto do escopo que lhe interessa. Desligar o plugin nos testes deixaria a suíte cega para qualquer regressão introduzida por ele.

### `trustProxy` fica desligado enquanto não houver proxy na frente

O limitador identifica o chamador pelo IP que o Fastify reporta. Com `trustProxy` ligado, esse IP passa a sair do cabeçalho `X-Forwarded-For`, que é enviado pelo cliente e portanto forjável por ele. Num deploy sem proxy reverso, ligar essa opção significa deixar qualquer atacante escolher o próprio identificador a cada requisição e nunca alcançar teto nenhum, o que é o mesmo que não ter limitador.

A decisão tem o outro lado, e ele importa tanto quanto. Num deploy que já esteja atrás de um proxy reverso, manter a opção desligada faz com que toda requisição chegue com o endereço do proxy, então o teto global de cem por minuto passa a valer para o serviço inteiro em vez de valer por cliente, e um único usuário ativo tranca todos os demais. A opção só passa a fazer sentido quando existe de fato um proxy confiável na frente da aplicação, porque é ele que sobrescreve o cabeçalho com o endereço real da conexão, e a partir daí ligá-la deixa de ser opcional. Como o projeto é um scaffold e não tem um ambiente de deploy definido, a configuração fica no padrão da biblioteca, desligada, e entra junto com a infraestrutura que a justificar.

### A tabela entra como migration incremental

`credential_throttle` vem depois do baseline, então ela não regenera o schema inicial. `pnpm db:generate` produz uma migration aditiva com o `CREATE TABLE` e o índice sobre `last_failed_at`, sem tocar em nenhuma tabela existente. A chave primária é o `integer` gerado por identidade, no mesmo padrão das demais tabelas, e `key_hash` carrega a restrição de unicidade que sustenta o upsert do adaptador. O índice sobre `last_failed_at` existe porque é por esse campo que uma limpeza futura de linhas frias vai varrer a tabela.

## Definition of done

* `blockSecondsForFailures` em `src/lib/throttle.ts` cobrindo as três tentativas livres, o crescimento de cinco vezes a partir de um minuto e o teto de uma hora, com teste para cada faixa
* `hashThrottleKey` em `src/lib/token-hash.ts` devolvendo digest SHA-256 estável, com teste provando que o endereço não é legível no resultado
* Tabela `credential_throttle` no schema Drizzle e migration incremental aditiva sob `drizzle/`, sem regeneração do baseline
* Fatia `src/plugins/app/credential-throttle/` com porta, adaptador Drizzle, serviço e o decorator `fastify.credentialThrottle`, mais `AppOptions.credentialThrottleRepository` para a substituição em teste
* Adaptador em memória em `tests/helpers/credential-throttle/in-memory-repository.ts` usado por todo teste que toca o bloqueio
* Serviço coberto por teste em `check`, `registerFailure` e `reset`, incluindo o `Retry-After` nunca abaixo de um segundo, o recomeço da contagem quando a última falha é mais antiga que o teto e a linha chaveada por hash em vez de endereço
* `login` e `changePassword` devolvendo `{ outcome: "throttled", retryAfterSeconds }`, com teste provando que `verifyPassword` não é chamado no caminho bloqueado e que as duas rotas registram a falha sob a mesma chave
* `resetPassword` apagando a linha do bloqueio no caminho de sucesso, com a mesma chave que `login` e `changePassword` usam e sem leitura nova ao banco, coberto por teste que prova a limpeza no sucesso e a ausência dela quando o código está errado ou a recuperação expirou
* `POST /auth/login` e `POST /auth/change-password` respondendo `429` com `{ "message": "Too many attempts. Try again later." }` e cabeçalho `Retry-After` em segundos, com o `429` publicado no OpenAPI das duas rotas
* Teste de rota provando que um email sem conta é bloqueado do mesmo jeito que um email existente
* `@fastify/rate-limit` registrado globalmente em `src/plugins/external/rate-limit.ts`, com store em memória e teto geral por minuto
* Políticas por escopo em `src/lib/rate-limit.ts`, resolvidas por `rateLimitFor` e declaradas em `config.rateLimit` de toda rota sob `src/routes/auth/`
* Handler de rota não encontrada passando pelo limitador e respondendo `{ "message": "Not Found." }`
* Teto de teste alto em `tests/helpers/app-options.ts`, com o limitador ativo na suíte e o teste do `429` abaixando apenas o escopo que exercita
* Teste provando que o `204` segue sem corpo e que o `404` mantém o formato do `error-handler` depois do registro do limitador
* `pnpm typecheck`, `pnpm lint`, `pnpm test` e `pnpm build` verdes
