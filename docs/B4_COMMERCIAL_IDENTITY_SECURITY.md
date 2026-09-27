# IRON — Bloco 4: Identidade e Segurança Comercial

Status: CERTIFIED — implementação interna concluída e promovida em `main` pelo PR #60. Entrega real de e-mail continua dependência externa de homologação.

## Autoridade canônica

A autoridade de identidade permanece em User + Session + UserRole/RBAC + tenant-context. Não foi criado sistema paralelo de autenticação.

Cadastro público comercial canônico: POST /commercial/trial/start. O endpoint histórico /auth/register deixa de ser superfície pública para impedir criação de usuário órfão e bypass do provisioning/tenant.

## Senha

Novas senhas e trocas/reset exigem 12–128 caracteres com maiúscula, minúscula, número e símbolo. Login e step-up continuam aceitando o formato de senha atual para não bloquear contas legadas; a política forte é aplicada na próxima criação/troca.

## Sessão, refresh e revogação

Access JWT inclui sid e JwtStrategy valida a Session canônica em toda requisição autenticada.

Refresh:
- segredo opaco armazenado somente por hash;
- rotação atômica;
- hash anterior preservado apenas para detecção de replay;
- reuse do refresh anterior revoga a família/session;
- idle TTL de 30 dias;
- lifetime absoluto de 90 dias;
- logout/revogação torna o access JWT imediatamente inválido porque o sid é verificado no servidor.

Lista e revogação de sessões são tenant-independent e user-scoped. Operações de revogação administrativa do próprio usuário exigem step-up.

## Rate limiting / brute force / abuse

AuthRateLimitBucket é a autoridade física de rate-limit; AuditLog não é usado para decidir bloqueio.

Buckets independentes cobrem:
- requests de login por IP;
- falhas de login por identidade/IP;
- signup público por IP/e-mail;
- recovery/verificação por IP/e-mail.

O IP usado por rate-limit é req.ip. TRUST_PROXY_HOPS deve refletir a topologia real; valor incorreto não deve ser habilitado por conveniência.

## Anti-enumeration

Login usa mensagem genérica de credenciais e executa bcrypt também para identidade inexistente.

Password reset e email verification sempre respondem accepted=true independentemente de existência da conta.

Signup retorna erro comercial genérico para conflito e não informa qual campo já existe.

## MFA

MFA usa TOTP RFC 6238 compatível (SHA-1/30 s/6 dígitos) com janela ±1 step.

O segredo TOTP é cifrado AES-256-GCM com MFA_ENCRYPTION_KEY externa ao repositório. Recovery codes são emitidos uma única vez e persistidos somente por hash.

Fluxos:
- setup requer senha atual;
- confirmação exige TOTP válido;
- login com MFA habilitado nunca cria Session sem segundo fator;
- recovery code é one-time;
- enable/disable MFA revoga sessões existentes.

## Step-up

Alteração de senha, alteração de e-mail, revogação de sessões e disable MFA exigem senha atual e, quando MFA está habilitado, TOTP ou recovery code válido.

## Password reset / email verification / email change

AuthActionToken é one-time, possui TTL, hash do segredo, consumedAt e ciphertext de entrega cifrado por AUTH_ACTION_TOKEN_ENCRYPTION_KEY.

O backend implementa emissão e consumo seguros. A entrega real de e-mail é dependência externa: os registros ficam PENDING até um adapter de e-mail homologado ser conectado. Nenhuma homologação de provider de e-mail é declarada neste bloco.

Password reset e email change revogam sessões ativas.

## Segurança de logs e secrets

AuditService redige password/currentPassword/newPassword/token/refresh/MFA/recoveryCode/deliveryCiphertext e demais segredos conhecidos.

JWT_SECRET, MFA_ENCRYPTION_KEY e AUTH_ACTION_TOKEN_ENCRYPTION_KEY permanecem apenas em secret store/env.

## E-mail verificado

AUTH_REQUIRE_VERIFIED_EMAIL controla a exigência de verificação. O default do exemplo permanece false até existir entrega de e-mail real homologada. Ativar true sem provider de entrega bloquearia usuários legitimamente, portanto essa ativação pertence ao gate físico de infraestrutura/homologação.

## Gate

CANDIDATE somente pode ser promovido após Prisma generate, lint/typecheck, build, regressão S0–S12 aplicável, testes adversariais B4, branch CI, Web/mobile CI, PR CI, mergeability, merge autorizado e CI pós-merge.
