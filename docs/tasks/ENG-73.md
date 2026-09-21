# Profile agnóstico criado na promoção do signup

## Introdução

Revoga a decisão lazy registrada na ENG-57: a linha de `profiles` passa a ser criada junto com o usuário, e a tabela deixa de ter campos de domínio (enfermagem) — o auth scaffold é agnóstico de produto.

## Requisitos técnicos

* **Schema `profiles`**: dropar a coluna `coren`; trocar o enum `profile_role` de `nurse|admin` para `user|admin`, com default `user`; `full_name` permanece (nullable, agnóstico)
* **Migration nova** via Drizzle Kit (`db:generate`), sem editar a migration `0000`
* **Criação eager**: `promotePendingSignup()` passa a inserir a linha de `profiles` (`{ user_id }`, resto default/null) **dentro da mesma transação** que cria `auth_users`, apaga `pending_signups` e cria a sessão — invariante: todo `auth_user` tem profile
* Nenhum outro ponto do código cria profile (login e futuro `/me` apenas leem)
* Atualizar a descrição/espelho da ENG-57, que registrava a decisão lazy revogada

## Definição de pronto

* Migration gerada e aplicável
* Promoção criando profile na mesma transação, coberta por teste unitário
* Espelho da ENG-57 atualizado junto
