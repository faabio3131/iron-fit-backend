# P6 — certificação de composição IRON/NFCore A1

Candidata NFCore fixa: `e12d18b9795b9e231f44b52012a31e37be2cc73e` (#562). Candidata IRON #277.
A CI dedicada usa o serviço compilado FiscalA1DelegationService e FiscalBridgeHttpTransport, TLS local com CA explícita, API canônica NFCore, WorkloadAuthenticator, S2SAuthorizer, binding e perfil persistentes PostgreSQL, EncryptedA1Vault. Somente a resolução upstream do gym/CNPJ/conexão IRON e o ator autenticado são fixtures; não afirmar E2E do login real ou homologação oficial. Certificados PKCS#12 autoassinados gerados no runner, material/credenciais temporários eliminados, sem emissão fiscal, rede externa fiscal ou dados de cliente.

Testes: upload direto, readback, CORS, consumo único, CNPJ incorreto, escopo alheio, capability de retirada independente, invalidação de grants, replay após substituição, isolamento A/B, ciphertext. Gate O23 e revisão independente de segurança permanecem distintos. Não ativar produção, nem confundir retirada local com revogação ICP-Brasil. Resultado será apurado na CI do HEAD exato; não herdar PASS das CIs anteriores.
