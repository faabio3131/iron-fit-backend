# O15 — Configurações + Entitlements

Status: **CANDIDATE**

O15 não altera a autoridade do domínio de Product Entitlements.

## Autoridade preservada

- plano publicado continua sendo a autoridade superior do tenant;
- configuração da academia só pode restringir o plano;
- preferência do aluno só pode restringir a configuração efetiva da academia;
- ausência, inconsistência ou ampliação indevida continua falhando fechado;
- leitura/mutação de configurações da academia permanece em SUPER_ADMIN/OWNER com step-up.

## Read model comercial

`GET /product-entitlements/tenant/features` passa a incluir, de forma aditiva:

- `planValue`: valor concedido pelo plano antes da configuração do tenant;
- `definition.domain`;
- `definition.description`;
- `definition.allowedPolicyValues` quando a capability é POLICY.

Esses campos permitem que a Web apresente recursos, limites e políticas em linguagem de produto sem hardcode de regras ou tentativa de reconstruir autoridade no frontend.
