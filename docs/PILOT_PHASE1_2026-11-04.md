# Piloto — Fase 1 — 04/11/2026

## Retomada comprovada

Backend main `23a2a5b` / PR #215 MERGED / pós-merge `41119522850` SUCCESS.
App/Web main `12e74e8f5931ed8a7161bd6dba868150d9946d10` / PR #82 MERGED / pós-merge `41119589227` SUCCESS.
Catracas multimarcas: implementação interna não equivale a homologação física. Nenhum deploy realizado nesta retomada.
O checkpoint de 29/10 `681c5b0` é histórico; não reconstruir adapters/recuperação já integrados depois dele.

## Reconciliação com cronograma piloto de 04/11

- Backend: `faabio3131/iron-fit-backend`.
- Web e mobile atuais: `faabio3131/iron-fit-app`. O antigo web-platform foi renomeado `fm-tecnologia-web-platform-n-o-usar`; não modificar.
- Tenant atual: `Gym`. Não existe `GymUnit` no schema; não criar um segundo domínio só para cumprir nomenclatura do documento. Endereço/unidade operacional permanecem gap de levantamento, não dados inventados.
- PE0–PE4: usar `ProductPlanVersion` PUBLISHED e seus entitlements canônicos. O seed não cria capabilities, não publica plano e não habilita todos os recursos por bypass. Selecionar e verificar o plano adequado antes de aplicar.
- APK Android não instala em iOS. O gate de dois aparelhos requer distribuição iOS própria, assinatura e aparelho real; APK não comprova esse gate.

## Seed seguro

Executar migrations e configuração canônica de RBAC/planos antes do seed.
`npm run pilot:seed` usa `IRON_PILOT_CONFIG_PATH` para JSON privado:

```json
{
  "gym": { "name": "NOME REAL", "slug": "slug-real", "timezone": "America/Sao_Paulo" },
  "planVersionId": "ID REAL DE VERSAO PUBLICADA",
  "effectiveUntil": "DATA ISO REAL DO FIM DO PILOTO",
  "users": [
    { "role": "OWNER", "name": "NOME REAL", "email": "email real" },
    { "role": "RECEPTION", "name": "NOME REAL", "email": "email real" },
    { "role": "TRAINER", "name": "NOME REAL", "email": "email real" }
  ]
}
```

Ambiente do processo: `IRON_RUNTIME_ENV=HOMOLOG`, `IRON_PILOT_APPLY=slug-real` e três secrets independentes `IRON_PILOT_OWNER_PASSWORD`, `IRON_PILOT_RECEPTION_PASSWORD`, `IRON_PILOT_TRAINER_PASSWORD`. Fornecer via cofre/ambiente protegido; nunca commitar JSON com dados reais ou secrets, nem colocar senhas em argumentos de terminal.
Prazo: futuro, máximo 31 dias. Senhas seguem política canônica, bcrypt custo 12 e máximo 72 bytes.
Execução atômica SERIALIZABLE; auditoria sem senha/hash. Replay não troca senha, papel nem assinatura; colisão com academia/conta existente é recusada. Drift de acesso/assinatura é recusado, sem reparação automática de autoridade.
E-mail não é marcado como verificado pelo seed. Se a política exigir verificação, concluir o fluxo real antes do gate de login. MFA e step-up continuam sob a política existente.

## Gate e bloqueios reais

Fase 1 NÃO CONCLUÍDA até criação no ambiente piloto e login Web real dos três perfis.
Pendentes: nome/dados da academia e equipe, destino de homologação na Contabo, plano publicado adequado, provisioning seguro de credenciais e eventuais verificações de e-mail. Não usar usuários fictícios para declarar tenant real pronto.
Próximo passo: CI integral desta entrega, merge somente verde, pós-merge; obter dados operacionais faltantes e aplicar no ambiente piloto autorizado. Depois do gate 1, avançar sequencialmente para Fase 2.
