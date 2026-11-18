# IRON FIT CORE — pendências externas separadas do fechamento de engenharia

**Checkpoint:** 2026-11-17 (execução verificada em 2026-11-18 UTC). **Ambiente verificado:** HOMOLOG.
**Diretriz do proprietário:** finalizar integralmente engenharia, código, testes automatizados, CI, PRs, reconciliação e implantação interna antes de solicitar ações de homologação externas. Não cobrar intervenções externas durante o fechamento interno.

## PENDÊNCIA EXTERNA — responsável pela comprovação final: titular/provedor/equipamento

| Dependência | Classificação | Comprovação ainda necessária | Não confundir com |
| --- | --- | --- | --- |
| Cakto / pagamentos financeiros reais FM→academia e academia→aluno | **PENDÊNCIA EXTERNA — IMPLEMENTED / EXTERNAL BLOCKER** quando o adapter respectivo estiver implementado e certificado internamente | Conta/KYC, ofertas reais autorizadas, secrets do provider via Vault, pagamento e estorno reais, webhook/settlement e autorização expressa para transação | Testes de checkout/webhook assinados em CI, sandbox, URL candidata, redirect e fatura `PENDING` |
| E-mail transacional da FM e entrega física | **PENDÊNCIA EXTERNA — IMPLEMENTED / EXTERNAL BLOCKER** quando o worker/adapters estiverem certificados internamente | Conta/domínio do remetente, DNS SPF/DKIM/DMARC, provedor, credencial externa, entrega real, bounce e feedback observado | Testes de fila, redaction, retries/DLQ e adapter em ambiente descartável |
| Equipamentos de controle de acesso, leitores/biometria/catracas e dispositivos móveis físicos | **PENDÊNCIA EXTERNA — IMPLEMENTED / EXTERNAL BLOCKER** para cada adapter interno certificado; outros conectores ficam **DISABLED / OUT OF LAUNCH** até suportados | Dispositivo/SDK oficial, ambiente físico, ativação autorizada, teste presencial do equipamento e prova de funcionamento | QR/código implementado, simulador, unit test ou endpoint que não comanda hardware real |
| Vídeos de exercícios — curadoria profissional, fonte e direitos | **PENDÊNCIA EXTERNA — REVISÃO HUMANA** (não `PRODUCTION HOMOLOGATED`) | Profissional habilitado verifica técnica por exercício, vídeo correto, disponibilidade, licenciamento e direitos de uso; revisão/rejeição/alternativa rastreável | 272 movimentos no catálogo, 110 URLs candidatas, URL no banco ou sucesso ao abrir YouTube |
| Emissão/consulta/cancelamento fiscal oficial NFS-e, certificado A1 e município/provedor, quando requeridos | **PENDÊNCIA EXTERNA — IMPLEMENTED / EXTERNAL BLOCKER** **somente depois** do fluxo interno seguro de A1/onboarding/readiness estar implementado | A1 do titular, provider e município oficial/ambiente autorizado, credenciais fiscais, emissão/consulta/cancelamento e evidência de homologação oficial | `FiscalScopeBinding`, status `HOMOLOGATION_READY`, certificado sintético, adaptador ou migração |

**Nota importante:** a classificação externa acima **não equivale** a certificar a implementação interna de cada domínio. Enquanto testes/CI/API/Web/worker não fecharem, a respectiva engenharia continua **PENDÊNCIA INTERNA** e deve ser executada antes de acionar o proprietário. Dependências externas não permitem reduzir o escopo interno.

## PENDÊNCIA INTERNA — responsabilidade de engenharia, não transferir ao proprietário

1. P3 assinatura e contratação: reconciliar leitura canônica FM Command, ofertas por plano/ciclo, owner bloqueado/step-up, checkout invoice-bound, webhook→outbox→licença e testes adversariais **sem pagamento real**. Critérios em `docs/O12_BILLING_IRON.md` e issue #243.
2. P6 IRON↔NFCore: criar a integração **canônica e autorizada** para onboarding de empresa/unidade, comprovação do vínculo CNPJ/tenant, upload A1 delegado direto no NFCore com token curto/one-use, consulta de status e governança de município, sem PFX/senha atravessar IRON; issue backend #249 e NFCore #524. **Não** chamar portal humano com JWT IRON.
3. Confirmar readback dos dados já persistidos: auditoria read-only `scripts/audit-exercise-video-inventory.mjs` implantada; contagem PostgreSQL ainda `NOT_MEASURED` sem execução operacional.
4. Macro P→Q→R→S (interno): jornadas completas de teste (API, PostgreSQL, Web/mobile), negativos de segurança, carga, CI, backups, restore/rollback, release e prontidão para injetar configurações externas **sem** declarar ativação comercial.
5. Não fechar issue com base em plano ou CI de HEAD anterior. Documentar resultado por commit, PR, workflow e ambiente.

## CURRENT comprovado nesta separação

- Backend `main` = `9e8fc5c80d7bf1e08efb5ff0c01d659d664d4754`; `production` = `b4d2088cf9c18cb04321a5021726d18e07a9794a`; ambas com a mesma árvore Git `ebcb17a1717b9d06a58121a511cb7835564f8018`. CI pós-merge production #44216402713 **SUCCESS**.
- App `main` = `edd72f51f3f335c29ad8be7aed56f857a49b7125`; `production` = `77e28cba832a1e1e1c3ece7b93f0365afa26df12`. CI pós-merge production #44216664831 **SUCCESS**.
- HTTP público API `/api/v1/health` reportou `runtimeEnvironment=HOMOLOG` e `releaseVersion=prod-b4d2088-77e28cb` na verificação de 18/11 UTC. Não é certificação de provider externo.
- Ferramenta de auditoria de vídeos publicada; leitura efetiva do PostgreSQL físico e revisão profissional permanecem distintas. Host de execução remota via Desktop Commander atingiu quota mensal durante o atendimento anterior; não substituir resultado pela seed.
- **Resultado global:** engenharia ainda em andamento; **não declarar IRON FIT CORE V1.0.0 — GO-LIVE CERTIFIED** sem evidências internas e gates externos.

## Transição de responsabilidade (somente quando engenharia interna = 100% certificada)

Entregar ao proprietário um único **pacote de homologação externa** com status por provider, pré-requisitos, fluxo passo a passo, credenciais inseridas exclusivamente pelo Vault/console oficial, critérios objetivos de PASS/FAIL, rollback, proteção de dados, ambientes e evidências necessárias. Nunca solicitar PFX, segredo ou senha por chat/GitHub. Até lá, executar autonomamente as tarefas internas e classificar provedores sem comprovação como **não homologados**.
