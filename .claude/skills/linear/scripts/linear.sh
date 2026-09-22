#!/usr/bin/env bash
# CLI único para o Linear via API GraphQL. Ver ../SKILL.md.
# Requer: curl, jq. Lê LINEAR_API_KEY, LINEAR_TEAM_KEY, LINEAR_PROJECT do ambiente (.env).
# Saída sempre JSON no stdout; erros no stderr com exit != 0.
set -euo pipefail

API_URL="https://api.linear.app/graphql"
SELF="$(basename "$0")"

fail() { echo "Erro: $*" >&2; exit 1; }

# o .env do diretório atual (raiz do projeto) é obrigatório
load_env() {
  [ -f "$PWD/.env" ] || fail ".env não encontrado em $PWD. Crie-o a partir do .env.sample e rode o CLI a partir da raiz do projeto."
  set -a; . "$PWD/.env"; set +a
}

require_deps() {
  command -v curl >/dev/null 2>&1 || fail "curl é necessário e não está no PATH."
  command -v jq >/dev/null 2>&1 || fail "jq é necessário e não está no PATH."
  command -v uuidgen >/dev/null 2>&1 || fail "uuidgen é necessário e não está no PATH."
}
require_key() {
  [ -n "${LINEAR_API_KEY:-}" ] || fail "LINEAR_API_KEY não encontrada no ambiente. Defina-a no .env."
}

# resolve o team: flag > LINEAR_TEAM_KEY. Falha se nenhum.
resolve_team_key() {
  local k="${1:-}"
  [ -n "$k" ] || k="${LINEAR_TEAM_KEY:-}"
  [ -n "$k" ] || fail "Team não definido. Passe --team <KEY> ou defina LINEAR_TEAM_KEY no .env."
  echo "$k"
}
# resolve o projeto: flag > LINEAR_PROJECT. Vazio é permitido (nem toda operação exige).
resolve_project_name() {
  local p="${1:-}"
  [ -n "$p" ] || p="${LINEAR_PROJECT:-}"
  echo "$p"
}

# 3 tentativas: a maioria das falhas transitórias (5xx/rede) resolve na segunda.
# Mutations são idempotentes porque create/comment enviam id UUID do cliente.
MAX_RETRIES=3
gql() {
  # bash 3.2 (macOS) fecha a expansão no primeiro '}' de "${2:-{}}", vazando um '}' literal — default fora da expansão
  local query="$1" vars="${2:-}" payload response code body attempt
  [ -n "$vars" ] || vars='{}'
  payload=$(jq -n --arg q "$query" --argjson v "$vars" '{query:$q,variables:$v}')
  for attempt in 1 2 3; do
    response=$(curl -sS -w '\n%{http_code}' -X POST "$API_URL" \
      -H "Content-Type: application/json" -H "Authorization: $LINEAR_API_KEY" --data "$payload") || response=$'\n000'
    code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    # 000 = falha de rede/curl; 5xx = erro transitório do servidor
    if [ "$code" = "000" ] || [ "$code" -ge 500 ] 2>/dev/null; then
      [ "$attempt" -lt "$MAX_RETRIES" ] || fail "API do Linear indisponível após $MAX_RETRIES tentativas (HTTP $code)."
      echo "Aviso: HTTP $code, tentativa $attempt/$MAX_RETRIES, aguardando $((attempt * 2))s..." >&2
      sleep $((attempt * 2)); continue
    fi
    break
  done
  [ "$code" != "429" ] || fail "Rate limit (HTTP 429). Personal API keys: 1500 req/hora. Aguarde e repita."
  if [ "$code" -ge 400 ] 2>/dev/null; then fail "HTTP $code da API do Linear: $body"; fi
  if echo "$body" | jq -e '.errors' >/dev/null 2>&1; then fail "Erro do GraphQL: $(echo "$body" | jq -c '.errors')"; fi
  echo "$body"
}

team_id_from_key() {
  local key id
  key=$(resolve_team_key "${1:-}")
  id=$(gql 'query($k:String!){teams(filter:{key:{eq:$k}}){nodes{id}}}' "$(jq -n --arg k "$key" '{k:$k}')" \
    | jq -r '.data.teams.nodes[0].id // empty')
  [ -n "$id" ] || fail "Team '$key' não encontrado. Rode '$SELF teams'."
  echo "$id"
}
project_id_from_name() {
  local name count res
  name=$(resolve_project_name "${1:-}")
  [ -n "$name" ] || { echo ""; return; }
  res=$(gql 'query($n:String!){projects(filter:{name:{eq:$n}}){nodes{id name}}}' "$(jq -n --arg n "$name" '{n:$n}')")
  count=$(echo "$res" | jq '.data.projects.nodes | length')
  [ "$count" != "0" ] || fail "Projeto '$name' não encontrado. Rode '$SELF projects'."
  [ "$count" = "1" ] || fail "Mais de um projeto chamado '$name'. Ajuste LINEAR_PROJECT ou o nome."
  echo "$res" | jq -r '.data.projects.nodes[0].id'
}
# labels do workspace (team null) + do team; grupos aparecem mas não são aplicáveis a issues
usable_labels() {
  local key="$1"
  gql 'query{issueLabels(first:250){nodes{id name isGroup parent{name} team{key}}}}' \
    | jq --arg k "$key" '[.data.issueLabels.nodes[]|select(.team==null or .team.key==$k)]'
}
label_ids() {
  local team_key="$1" names="$2" res ids id n
  res=$(usable_labels "$team_key")
  ids="[]"
  IFS=',' read -ra NS <<< "$names"
  for n in "${NS[@]}"; do
    n=$(echo "$n" | xargs)
    if echo "$res" | jq -e --arg n "$n" 'any(.[]; .name==$n and .isGroup)' | grep -q true; then
      fail "'$n' é um grupo de labels; grupos não são aplicáveis. Use uma label filha (rode '$SELF labels')."
    fi
    id=$(echo "$res" | jq -r --arg n "$n" '[.[]|select(.name==$n and (.isGroup|not))][0].id // empty')
    [ -n "$id" ] || fail "Label '$n' não existe (workspace ou team). Rode '$SELF labels'."
    ids=$(echo "$ids" | jq --arg id "$id" '. + [$id]')
  done
  echo "$ids"
}
# toda issue precisa de exatamente um type (grupo 'type' do workspace)
require_type_label() {
  local names="${1:-}" n count=0
  IFS=',' read -ra NS <<< "$names"
  for n in "${NS[@]+"${NS[@]}"}"; do
    n=$(echo "$n" | xargs)
    case "$n" in bug|feature|spike) count=$((count+1));; esac
  done
  [ "$count" -eq 1 ] || fail "--labels precisa conter exatamente um type: bug, feature ou spike (recebido: ${names:-nenhum})."
}
issue_uuid() {
  local uuid
  uuid=$(gql 'query($id:String!){issue(id:$id){id}}' "$(jq -n --arg id "$1" '{id:$id}')" \
    | jq -r '.data.issue.id // empty')
  [ -n "$uuid" ] || fail "Issue '$1' não encontrada."
  echo "$uuid"
}
# valida a estimativa contra a escala Fibonacci configurada no workspace
validate_estimate() {
  case "$1" in 1|2|3|5|8) ;; *) fail "--estimate deve ser 1, 2, 3, 5 ou 8 (escala Fibonacci do workspace).";; esac
}
state_id_from_name() {
  local team_id="$1" name="$2" id
  id=$(gql 'query($t:String!){team(id:$t){states{nodes{id name}}}}' "$(jq -n --arg t "$team_id" '{t:$t}')" \
    | jq -r --arg n "$name" '.data.team.states.nodes[]|select(.name|ascii_downcase==($n|ascii_downcase))|.id' | head -n1)
  [ -n "$id" ] || fail "Estado '$name' não existe nesse team. Rode '$SELF states'."
  echo "$id"
}

# ---------- comandos de leitura ----------
cmd_teams() { gql '{teams{nodes{id key name}}}' | jq '.data.teams.nodes'; }
cmd_projects() { gql '{projects{nodes{id name state}}}' | jq '.data.projects.nodes'; }
cmd_states() {
  local team_id; team_id=$(team_id_from_key "${TEAM_FLAG:-}")
  gql 'query($t:String!){team(id:$t){states{nodes{id name type position}}}}' "$(jq -n --arg t "$team_id" '{t:$t}')" \
    | jq '.data.team.states.nodes | sort_by(.position)'
}
cmd_labels() {
  local key; key=$(resolve_team_key "${TEAM_FLAG:-}")
  usable_labels "$key"
}

cmd_get() {
  local id=""
  while [ $# -gt 0 ]; do case "$1" in --id) id="$2"; shift 2;; *) fail "Argumento desconhecido: $1";; esac; done
  [ -n "$id" ] || fail "--id é obrigatório (ex: ABC-123 ou UUID)."
  local res issue
  res=$(gql 'query($id:String!){issue(id:$id){id identifier title description priority estimate url branchName createdAt updatedAt state{name type} assignee{name email} team{key name} project{name} labels{nodes{name}}}}' "$(jq -n --arg id "$id" '{id:$id}')")
  issue=$(echo "$res" | jq '.data.issue')
  [ "$issue" != "null" ] || fail "Issue '$id' não encontrada. Se você só tem um assunto, use 'search'."
  echo "$issue"
}

cmd_search() {
  local q="" team="" limit=10
  while [ $# -gt 0 ]; do case "$1" in
    --query) q="$2"; shift 2;; --team) team="$2"; shift 2;; --limit) limit="$2"; shift 2;;
    *) fail "Argumento desconhecido: $1";; esac; done
  [ -n "$q" ] || fail "--query é obrigatório."
  [ -n "$team" ] || team="${LINEAR_TEAM_KEY:-}"
  local filter
  if [ -n "$team" ]; then
    filter=$(jq -n --arg q "$q" --arg t "$team" '{title:{containsIgnoreCase:$q},team:{key:{eq:$t}}}')
  else
    filter=$(jq -n --arg q "$q" '{title:{containsIgnoreCase:$q}}')
  fi
  gql 'query($f:IssueFilter,$n:Int){issues(filter:$f,first:$n,orderBy:updatedAt){nodes{identifier title url state{name} priority team{key}}}}' \
    "$(jq -n --argjson f "$filter" --argjson n "$limit" '{f:$f,n:$n}')" | jq '.data.issues.nodes'
}

cmd_list() {
  local team="" status="" assignee="" label="" project="" limit=25
  while [ $# -gt 0 ]; do case "$1" in
    --team) team="$2"; shift 2;; --status) status="$2"; shift 2;; --assignee) assignee="$2"; shift 2;;
    --label) label="$2"; shift 2;; --project) project="$2"; shift 2;; --limit) limit="$2"; shift 2;;
    *) fail "Argumento desconhecido: $1";; esac; done
  [ -n "$team" ] || team="${LINEAR_TEAM_KEY:-}"
  [ -n "$project" ] || project="${LINEAR_PROJECT:-}"
  local filter='{}'
  [ -n "$team" ] && filter=$(echo "$filter" | jq --arg t "$team" '. + {team:{key:{eq:$t}}}')
  [ -n "$status" ] && filter=$(echo "$filter" | jq --arg s "$status" '. + {state:{name:{eq:$s}}}')
  [ -n "$assignee" ] && filter=$(echo "$filter" | jq --arg a "$assignee" '. + {assignee:{name:{containsIgnoreCase:$a}}}')
  [ -n "$label" ] && filter=$(echo "$filter" | jq --arg l "$label" '. + {labels:{some:{name:{eq:$l}}}}')
  [ -n "$project" ] && filter=$(echo "$filter" | jq --arg p "$project" '. + {project:{name:{eq:$p}}}')
  gql 'query($f:IssueFilter,$n:Int){issues(filter:$f,first:$n,orderBy:updatedAt){nodes{identifier title state{name} priority estimate assignee{name} labels{nodes{name}}}}}' \
    "$(jq -n --argjson f "$filter" --argjson n "$limit" '{f:$f,n:$n}')" | jq '.data.issues.nodes'
}

# ---------- comandos de escrita ----------
cmd_create() {
  local team="" title="" description="" priority="" estimate="" labels="" project="" project_id="" parent=""
  while [ $# -gt 0 ]; do case "$1" in
    --team) team="$2"; shift 2;; --title) title="$2"; shift 2;; --description) description="$2"; shift 2;;
    --priority) priority="$2"; shift 2;; --estimate) estimate="$2"; shift 2;; --labels) labels="$2"; shift 2;;
    --project) project="$2"; shift 2;; --project-id) project_id="$2"; shift 2;; --parent) parent="$2"; shift 2;;
    *) fail "Argumento desconhecido: $1";; esac; done
  [ -n "$title" ] || fail "--title é obrigatório."
  [ -z "$estimate" ] || validate_estimate "$estimate"
  require_type_label "$labels"
  [ -z "$project" ] || [ -z "$project_id" ] || fail "Use --project (nome) ou --project-id (UUID), não os dois."
  local team_id input
  team_id=$(team_id_from_key "$team")
  [ -n "$project_id" ] || project_id=$(project_id_from_name "$project")
  input=$(jq -n --arg t "$team_id" --arg ti "$title" '{teamId:$t,title:$ti}')
  input=$(echo "$input" | jq --arg id "$(uuidgen | tr 'A-Z' 'a-z')" '. + {id:$id}')
  [ -n "$description" ] && input=$(echo "$input" | jq --arg d "$description" '. + {description:$d}')
  [ -n "$priority" ] && input=$(echo "$input" | jq --argjson p "$priority" '. + {priority:$p}')
  [ -n "$estimate" ] && input=$(echo "$input" | jq --argjson e "$estimate" '. + {estimate:$e}')
  [ -n "$project_id" ] && input=$(echo "$input" | jq --arg p "$project_id" '. + {projectId:$p}')
  [ -n "$parent" ] && input=$(echo "$input" | jq --arg pa "$parent" '. + {parentId:$pa}')
  [ -n "$labels" ] && input=$(echo "$input" | jq --argjson l "$(label_ids "$(resolve_team_key "$team")" "$labels")" '. + {labelIds:$l}')
  gql 'mutation($i:IssueCreateInput!){issueCreate(input:$i){success issue{identifier title url state{name}}}}' \
    "$(jq -n --argjson i "$input" '{i:$i}')" | jq '.data.issueCreate'
}

cmd_update() {
  local id="" title="" description="" priority="" estimate="" labels="" project="" team=""
  while [ $# -gt 0 ]; do case "$1" in
    --id) id="$2"; shift 2;; --title) title="$2"; shift 2;; --description) description="$2"; shift 2;;
    --priority) priority="$2"; shift 2;; --estimate) estimate="$2"; shift 2;;
    --labels) labels="$2"; shift 2;; --project) project="$2"; shift 2;;
    --team) team="$2"; shift 2;; *) fail "Argumento desconhecido: $1";; esac; done
  [ -n "$id" ] || fail "--id é obrigatório."
  [ -z "$estimate" ] || validate_estimate "$estimate"
  # --labels substitui o set inteiro da issue; o type precisa vir junto
  [ -z "$labels" ] || require_type_label "$labels"
  local input='{}'
  [ -n "$title" ] && input=$(echo "$input" | jq --arg t "$title" '. + {title:$t}')
  [ -n "$description" ] && input=$(echo "$input" | jq --arg d "$description" '. + {description:$d}')
  [ -n "$priority" ] && input=$(echo "$input" | jq --argjson p "$priority" '. + {priority:$p}')
  [ -n "$estimate" ] && input=$(echo "$input" | jq --argjson e "$estimate" '. + {estimate:$e}')
  if [ -n "$project" ]; then input=$(echo "$input" | jq --arg p "$(project_id_from_name "$project")" '. + {projectId:$p}'); fi
  if [ -n "$labels" ]; then input=$(echo "$input" | jq --argjson l "$(label_ids "$(resolve_team_key "$team")" "$labels")" '. + {labelIds:$l}'); fi
  [ "$input" != "{}" ] || fail "Nada para atualizar. Passe ao menos um campo."
  gql 'mutation($id:String!,$i:IssueUpdateInput!){issueUpdate(id:$id,input:$i){success issue{identifier title state{name}}}}' \
    "$(jq -n --arg id "$id" --argjson i "$input" '{id:$id,i:$i}')" | jq '.data.issueUpdate'
}

cmd_status() {
  local id="" state="" team=""
  while [ $# -gt 0 ]; do case "$1" in
    --id) id="$2"; shift 2;; --state) state="$2"; shift 2;; --team) team="$2"; shift 2;;
    *) fail "Argumento desconhecido: $1";; esac; done
  [ -n "$id" ] || fail "--id é obrigatório."
  [ -n "$state" ] || fail "--state é obrigatório (ex: 'In Progress'). Rode 'states' para ver os nomes."
  local team_id state_id
  team_id=$(team_id_from_key "$team")
  state_id=$(state_id_from_name "$team_id" "$state")
  gql 'mutation($id:String!,$i:IssueUpdateInput!){issueUpdate(id:$id,input:$i){success issue{identifier state{name}}}}' \
    "$(jq -n --arg id "$id" --argjson i "$(jq -n --arg s "$state_id" '{stateId:$s}')" '{id:$id,i:$i}')" | jq '.data.issueUpdate'
}

cmd_comment() {
  local id="" body=""
  while [ $# -gt 0 ]; do case "$1" in
    --id) id="$2"; shift 2;; --body) body="$2"; shift 2;; *) fail "Argumento desconhecido: $1";; esac; done
  [ -n "$id" ] || fail "--id é obrigatório."
  [ -n "$body" ] || fail "--body é obrigatório."
  gql 'mutation($i:CommentCreateInput!){commentCreate(input:$i){success comment{id url}}}' \
    "$(jq -n --argjson i "$(jq -n --arg id "$id" --arg b "$body" --arg cid "$(uuidgen | tr 'A-Z' 'a-z')" '{id:$cid,issueId:$id,body:$b}')" '{i:$i}')" | jq '.data.commentCreate'
}

cmd_import() {
  local file="" dry=0 team=""
  while [ $# -gt 0 ]; do case "$1" in
    --file) file="$2"; shift 2;; --dry-run) dry=1; shift;; --team) team="$2"; shift 2;;
    *) fail "Argumento desconhecido: $1";; esac; done
  [ -n "$file" ] && [ -f "$file" ] || fail "--file é obrigatório e precisa existir."
  jq -e 'type=="array" and length>0' "$file" >/dev/null 2>&1 || fail "O arquivo precisa ser um array JSON não-vazio."

  # fase de validação: TODOS os itens antes de criar QUALQUER um
  local total; total=$(jq length "$file")
  local i title estimate labels
  for i in $(jq -r 'keys[]' "$file"); do
    title=$(jq -r ".[$i].title // empty" "$file")
    estimate=$(jq -r ".[$i].estimate // empty" "$file")
    labels=$(jq -r ".[$i].labels // empty" "$file")
    [ -n "$title" ] || fail "Item $i: title vazio."
    jq -e ".[$i].description // \"\" | test(\"## Introdução\") and test(\"## Requisitos técnicos\") and test(\"## Definição de pronto\")" "$file" >/dev/null \
      || fail "Item $i ('$title'): description precisa das seções Introdução, Requisitos técnicos e Definição de pronto."
    [ -n "$estimate" ] || fail "Item $i ('$title'): estimate ausente."
    validate_estimate "$estimate"
    require_type_label "$labels"
  done

  if [ "$dry" = 1 ]; then
    jq -r '.[] | "\(.estimate)\t\(.labels)\t\(.title)"' "$file"
    echo "Dry-run OK: $total issues válidas, nada criado." >&2
    return
  fi

  # resolução única de team/projeto/labels para o lote inteiro
  local team_key team_id project_id all_labels
  team_key=$(resolve_team_key "$team")
  team_id=$(team_id_from_key "$team")
  project_id=$(project_id_from_name "")
  all_labels=$(usable_labels "$team_key")

  for i in $(jq -r 'keys[]' "$file"); do
    local input ids nm id
    input=$(jq -c ".[$i] | {title, description}" "$file" \
      | jq --arg t "$team_id" --arg uid "$(uuidgen | tr 'A-Z' 'a-z')" '. + {teamId:$t, id:$uid}')
    input=$(echo "$input" | jq --argjson e "$(jq ".[$i].estimate" "$file")" '. + {estimate:$e}')
    [ -z "$project_id" ] || input=$(echo "$input" | jq --arg p "$project_id" '. + {projectId:$p}')
    ids="[]"
    while IFS= read -r nm; do
      nm=$(echo "$nm" | xargs); [ -n "$nm" ] || continue
      echo "$all_labels" | jq -e --arg n "$nm" 'any(.[]; .name==$n and .isGroup)' | grep -q true \
        && fail "Item $i: '$nm' é um grupo de labels, use uma filha."
      id=$(echo "$all_labels" | jq -r --arg n "$nm" '[.[]|select(.name==$n and (.isGroup|not))][0].id // empty')
      [ -n "$id" ] || fail "Item $i: label '$nm' não existe."
      ids=$(echo "$ids" | jq --arg id "$id" '. + [$id]')
    done <<EOF2
$(jq -r ".[$i].labels" "$file" | tr ',' '\n')
EOF2
    input=$(echo "$input" | jq --argjson l "$ids" '. + {labelIds:$l}')
    gql 'mutation($i:IssueCreateInput!){issueCreate(input:$i){success issue{identifier title}}}' \
      "$(jq -n --argjson i "$input" '{i:$i}')" \
      | jq -r '.data.issueCreate.issue | "\(.identifier)\t\(.title)"' \
      || fail "Falha ao criar o item $i; itens anteriores já foram criados — corrija e re-rode o arquivo só com os restantes."
  done
}

cmd_relate() {
  local id="" blocks=""
  while [ $# -gt 0 ]; do case "$1" in
    --id) id="$2"; shift 2;; --blocks) blocks="$2"; shift 2;;
    *) fail "Argumento desconhecido: $1";; esac; done
  [ -n "$id" ] && [ -n "$blocks" ] || fail "Uso: relate --id ABC-A --blocks ABC-B (A bloqueia B)."
  local a b
  a=$(issue_uuid "$id"); b=$(issue_uuid "$blocks")
  gql 'mutation($i:IssueRelationCreateInput!){issueRelationCreate(input:$i){success issueRelation{id type}}}' \
    "$(jq -n --arg a "$a" --arg b "$b" '{i:{issueId:$a,relatedIssueId:$b,type:"blocks"}}')" \
    | jq '.data.issueRelationCreate'
}

cmd_reorder() {
  local ids=""
  while [ $# -gt 0 ]; do case "$1" in
    --ids) ids="$2"; shift 2;;
    *) fail "Argumento desconhecido: $1";; esac; done
  [ -n "$ids" ] || fail "Uso: reorder --ids ABC-1,ABC-2,... (ordem final, de cima para baixo)."
  # sortOrder bem negativo põe o bloco acima de qualquer issue não listada
  local order=-10000 id uuid out="[]"
  IFS=',' read -r -a arr <<< "$ids"
  for id in "${arr[@]}"; do
    uuid=$(issue_uuid "$id")
    gql 'mutation($id:String!,$i:IssueUpdateInput!){issueUpdate(id:$id,input:$i){success}}' \
      "$(jq -n --arg id "$uuid" --argjson s "$order" '{id:$id,i:{sortOrder:$s}}')" \
      | jq -e '.data.issueUpdate.success' >/dev/null || fail "Falha ao reordenar $id."
    out=$(echo "$out" | jq --arg id "$id" --argjson s "$order" '. + [{identifier:$id,sortOrder:$s}]')
    order=$((order + 10))
  done
  echo "$out"
}

usage() {
  cat >&2 <<EOF
Uso: $SELF <comando> [opções]   (team/projeto vêm do .env quando a flag é omitida)

Leitura:
  teams
  projects
  states                      [--team KEY]
  labels                      [--team KEY]
  get       --id ABC-123
  search    --query TEXTO      [--team KEY] [--limit N]
  list                        [--team KEY] [--status NOME] [--assignee NOME] [--label NOME] [--project NOME] [--limit N]

Escrita:
  create    --title TÍTULO     --labels "bug|feature|spike[,área]" [--description T] [--priority 0-4] [--estimate 1|2|3|5|8] [--project NOME] [--parent ABC-1] [--team KEY]
  update    --id ABC-123       [--title T] [--description T] [--priority 0-4] [--estimate 1|2|3|5|8] [--labels "..."] [--project NOME] [--team KEY]
  status    --id ABC-123 --state "In Progress"  [--team KEY]
  comment   --id ABC-123 --body TEXTO
  relate    --id ABC-A --blocks ABC-B   (A bloqueia B)
  reorder   --ids ABC-1,ABC-2,...       (ordem manual da view, de cima para baixo)
  import    --file plano.json   [--dry-run] [--team KEY]   (lote: validar tudo, depois criar)

Título/descrição em português; team, projeto e labels em inglês. Ver SKILL.md.
EOF
  exit 1
}

# alguns comandos de leitura aceitam --team antes do dispatch
TEAM_FLAG=""
main() {
  case "${1:-}" in -h|--help) usage;; esac
  require_deps; load_env; require_key
  local cmd="${1:-}"; [ -n "$cmd" ] || usage; shift || true
  # captura --team para states/labels (que não têm parser próprio de args longos)
  case "$cmd" in
    states|labels)
      while [ $# -gt 0 ]; do case "$1" in --team) TEAM_FLAG="$2"; shift 2;; *) fail "Argumento desconhecido: $1";; esac; done;;
  esac
  case "$cmd" in
    teams) cmd_teams;;
    projects) cmd_projects;;
    states) cmd_states;;
    labels) cmd_labels;;
    get) cmd_get "$@";;
    search) cmd_search "$@";;
    list) cmd_list "$@";;
    create) cmd_create "$@";;
    update) cmd_update "$@";;
    status) cmd_status "$@";;
    comment) cmd_comment "$@";;
    relate) cmd_relate "$@";;
    reorder) cmd_reorder "$@";;
    import) cmd_import "$@";;
    -h|--help) usage;;
    *) fail "Comando desconhecido: $cmd (rode '$SELF --help')";;
  esac
}
main "$@"
