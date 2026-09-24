# 17. Security headers and CORS

## Introdução

A API já trata bem o que acontece dentro dela. As credenciais são verificadas em tempo constante, a sessão vive num cookie `httpOnly`, as respostas de erro são genéricas para não revelar quais contas existem e o volume de requisições tem teto por IP e por email. Falta a camada que fala com o navegador, que é o contrato entre a resposta e o programa que a interpreta.

Essa camada tem duas metades. A primeira é o conjunto de cabeçalhos de resposta que instrui o navegador a não adivinhar tipo de conteúdo, a não deixar a página ser embutida em moldura de terceiro e a só voltar por HTTPS depois da primeira visita. A segunda é a política de origem cruzada, que decide qual origem pode falar com a API a partir de um navegador e se ela pode mandar o cookie de sessão junto. Hoje a API não emite nenhuma das duas, então qualquer frontend fica sem a permissão de que precisa e todo cliente fica sem as garantias que o navegador saberia aplicar.

Esta etapa entrega as duas metades com os plugins oficiais do Fastify, mantendo os defaults da biblioteca onde eles servem e configurando apenas o que o projeto de fato precisa decidir, que é qual origem tem permissão de conversar com a API.

## Requisitos técnicos

### Cada pacote de terceiro entra num arquivo só em `src/plugins/external/`

`@fastify/helmet` vira `src/plugins/external/helmet.ts` e `@fastify/cors` vira `src/plugins/external/cors.ts`, seguindo a regra que o projeto já aplica a cookie, swagger e rate limit. Cada arquivo exporta um plugin embrulhado em `fastify-plugin` com nome próprio, e o autoload de `src/app.ts` carrega a pasta `plugins/external` antes de `plugins/app` e de `routes`.

Essa ordem é o que faz o CORS funcionar sem nenhum trabalho extra. O `@fastify/cors` registra o próprio handler de `OPTIONS` quando entra na instância, e por entrar antes das rotas ele responde ao preflight do navegador em vez de deixar a requisição cair no handler de rota não encontrada. Nenhuma rota precisa ser escrita para isso.

### O Helmet roda com os defaults da biblioteca, porque cabeçalho não se configura por intuição

O plugin é registrado sem nenhuma diretiva escrita à mão. O conjunto que ele traz por padrão é fruto de anos de consenso sobre o que um serviço HTTP deve mandar, e reescrever esses valores por conta própria só troca uma decisão revisada por muita gente por um palpite. Na prática a resposta passa a levar `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Strict-Transport-Security` e os demais cabeçalhos do conjunto padrão.

Como o registro é global, os cabeçalhos valem para toda resposta, inclusive as de erro. Um `404` carrega o mesmo `nosniff` que um `200`, e isso importa porque uma resposta de erro também é conteúdo que o navegador vai interpretar. Um teste fixa esse caso junto com o caminho feliz.

### A CSP sai do caminho fora de produção, que é onde a interface do Swagger existe

A única decisão tomada dentro do plugin é desligar `contentSecurityPolicy` quando `NODE_ENV` não é `production`. A interface do Swagger, que o projeto registra apenas fora de produção, depende de script e estilo embutidos na página, e a política padrão do Helmet bloqueia exatamente isso. Sem esse ajuste a documentação abre em branco.

Relaxar a diretiva inteira fora de produção é melhor do que escrever uma lista de origens permitidas à mão. Uma CSP manual criada para acomodar o Swagger acabaria também valendo em produção, onde nenhuma página é servida pela API, então ela afrouxaria o ambiente que mais precisa da política para resolver um problema que só existe no ambiente que menos precisa. Em produção a CSP padrão do Helmet fica de pé, e um teste sobe a aplicação com `NODE_ENV` de produção só para provar que o cabeçalho é enviado ali.

### A origem do frontend vem do ambiente e é validada por uma regra positiva

`FRONTEND_ORIGIN` entra em `src/config/env.ts` como uma variável só, com uma origem só. Lista separada por vírgula foi considerada e recusada, porque hoje não existe um segundo frontend e resolver o caso múltiplo agora seria resolver um problema hipotético.

A validação afirma o que o valor precisa ser em vez de listar o que ele não pode ser. O valor é passado ao construtor de `URL`, precisa ter protocolo `http` ou `https`, e precisa ser idêntico ao `url.origin` resultante. Essa comparação sozinha já descarta caminho, query e barra final, porque `URL.origin` devolve apenas esquema, host e porta. Como consequência, `*` também não passa, sem que exista uma regra escrita contra ele.

Falta um detalhe que a comparação não pega. Uma string como `https://*.example.com` atravessa o parser de URL sem reclamar, já que o asterisco é um caractere aceitável num nome de host, e o `origin` resultante é igual ao valor original. Por isso a regra verifica também que o host não contém asterisco, o que fecha a porta para a forma curinga de subdomínio. A mensagem de erro diz o que se espera, uma origem absoluta `http` ou `https` sem caminho, barra final ou curinga, porque a barra final é o engano que alguém realmente comete ao preencher a variável e o erro precisa apontar a correção.

### A origem é obrigatória em produção e opcional fora dela

O campo segue o padrão condicional que `EMAIL_FROM` e `PORT` já usam no mesmo arquivo. Quando `NODE_ENV` é `production`, a variável é exigida e a aplicação não sobe sem ela, porque um deploy sem origem configurada é um deploy em que o frontend não consegue falar com a API, e falhar no boot é melhor do que descobrir isso pelo console do navegador. Fora de produção o campo é opcional e a string vazia também vale como não configurado, então desenvolvimento e teste continuam subindo sem nenhuma configuração nova.

`.env.sample` recebe a chave com valor vazio, junto das demais chaves de aplicação, para que quem clona o repositório veja que ela existe. Como o README manda copiar esse arquivo para `.env`, a chave chega ao ambiente presente e vazia, e é por isso que a string vazia precisa ser aceita fora de produção em vez de derrubar o boot. Em produção ela continua sendo recusada como qualquer outro valor que não seja uma origem, porque ali a ausência de origem é justamente o erro que se quer ver no boot.

### O CORS permite credenciais, porque a sessão vive em cookie `httpOnly`

O plugin é registrado com `credentials: true`. A sessão deste projeto não viaja em cabeçalho de autorização, ela viaja num cookie que o JavaScript da página não consegue ler, e o navegador só anexa esse cookie a uma requisição de origem cruzada quando a resposta permite credenciais. Sem essa opção o frontend faria login com sucesso e todas as requisições seguintes chegariam sem sessão.

A origem entra na configuração como lista de um elemento, e não como string. Com uma string, o plugin devolve aquele valor em `Access-Control-Allow-Origin` em toda resposta, inclusive nas de requisições que não trazem `Origin` nenhum, como uma chamada de servidor para servidor ou uma sonda de health check. Com uma lista, ele compara a origem recebida com as permitidas e só devolve o cabeçalho quando houver correspondência, além de marcar `Vary: Origin`, que é o que impede um cache intermediário de servir a resposta de uma origem para outra.

### Sem origem configurada, o plugin não é registrado e a API não emite cabeçalho de CORS

Quando `FRONTEND_ORIGIN` está ausente, que é a forma de desenvolvimento e de teste, o arquivo do plugin retorna sem registrar nada. A alternativa seria registrar o `@fastify/cors` com a permissão vazia, o que daria no mesmo resultado visível com uma camada a mais no caminho de toda requisição.

Não registrar é também a opção mais honesta sobre o que está acontecendo. Uma API sem CORS não é uma API que bloqueia origens, é uma API que não diz nada sobre origem, e quem bloqueia a requisição nesse caso é o navegador aplicando a política de mesma origem. Ferramentas que não são navegador, como `curl` e as sondas de infraestrutura, seguem funcionando normalmente nos dois cenários, porque elas não olham para esses cabeçalhos.

### O preflight conta no limite por IP, e o custo real é por sessão

A requisição `OPTIONS` que o navegador manda antes de um `POST` com corpo JSON é uma requisição como outra qualquer para o limitador por IP registrado na etapa anterior, então ela consome uma unidade do teto global. Isso é aceito de propósito e a configuração do limitador não é alterada aqui.

O motivo é que o custo é muito menor do que parece. O navegador guarda a resposta do preflight em cache pelo tempo que `Access-Control-Max-Age` indicar, então uma sessão de uso não gera um preflight por requisição, gera um por combinação de rota e método dentro da janela de cache. Abrir uma exceção no limitador para o método `OPTIONS` criaria um caminho sem teto que um varredor poderia usar à vontade, o que é um preço alto por uma economia pequena.

## Definition of done

* `@fastify/helmet` registrado em `src/plugins/external/helmet.ts`, com os defaults da biblioteca e nenhuma diretiva escrita à mão
* `contentSecurityPolicy` desligado quando `NODE_ENV` não é `production`, com teste provando a ausência do cabeçalho fora de produção e a presença dele em produção
* Teste provando que os cabeçalhos padrão aparecem tanto numa resposta de sucesso quanto numa de erro
* `FRONTEND_ORIGIN` em `src/config/env.ts`, validado como origem absoluta `http` ou `https`, sem caminho, sem barra final e sem curinga no host
* Variável obrigatória quando `NODE_ENV` é `production` e opcional fora de produção, seguindo o padrão condicional de `EMAIL_FROM`, com a string vazia aceita fora de produção e recusada dentro dela
* Casos de teste em `tests/config/env.test.ts` para a origem válida, o curinga puro, o curinga de subdomínio, o caminho, a barra final, o protocolo não HTTP e a string vazia nos dois ambientes
* `FRONTEND_ORIGIN=` com valor vazio em `.env.sample`
* `@fastify/cors` registrado em `src/plugins/external/cors.ts` apenas quando existe origem configurada, com a origem em lista e `credentials: true`
* Teste provando que a origem configurada recebe `Access-Control-Allow-Origin` e `Access-Control-Allow-Credentials`, que o preflight `OPTIONS` é respondido com sucesso, que uma origem desconhecida não recebe o cabeçalho, que uma requisição sem `Origin` é servida sem ele e que, com a origem ausente ou vazia, nenhum cabeçalho de CORS é emitido
* `pnpm typecheck`, `pnpm lint`, `pnpm test` e `pnpm build` verdes
