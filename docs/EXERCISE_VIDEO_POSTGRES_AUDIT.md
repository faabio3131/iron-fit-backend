# Exercícios — reconciliação de vídeos com PostgreSQL real

**Escopo:** contagem read-only da biblioteca canônica, não curadoria ou aprovação de mídia.
Este operador trabalha sobre o IRON FIT CORE existente, sem endpoint novo, migration,
credencial extra, API paralela, mudança de `Exercise.videoUrl` ou alteração de treinos.

## Execução sobre runtime autorizado

Após o merge, CI e deploy do Dockerfile que inclui a ferramenta, no host Contabo
já autorizado, com o compose canônico do produto:

```sh
cd /opt/fm/ironfit
docker compose exec -T api node scripts/audit-exercise-video-inventory.mjs
```

A ferramenta usa a conexão PostgreSQL da aplicação **somente para**
`prisma.exercise.findMany({ select: { name: true, videoUrl: true } })`.
Não escreve em banco, não executa seed, não modifica usuário, não resolve tenant,
não altera URL, não acessa gateway e não revela DATABASE_URL. Erros de conexão
são reduzidos a códigos seguros (ou `UNAVAILABLE`). Nunca copiar segredos de
log para tickets nem executar no banco de outra aplicação.

## Significado das métricas

- `source.catalogExercises`: movimentos versionados no catálogo;
- `source.directVideoCandidates`: URLs candidatas no código; **não aprovadas**;
- `source.searchOnly`: movimentos sem URL direta candidata;
- `source.pendingHumanReview`: fila de revisão profissional ainda pendente;
- `source.approvedInQueueNotIndependentlyVerified`: declaração no arquivo de
  curadoria, **sem** garantia de avaliação independente;
- `postgres.canonicalRowsFound` / `canonicalRowsMissing`: existência dos nomes
  canônicos no PostgreSQL consultado;
- `postgres.canonicalRowsWithVideo`: linhas existentes com URL não vazia;
- `postgres.matchingCandidateUrl`: URL persistida igual à candidata do catálogo,
  **não** corresponde a link verificado, conteúdo correto ou direito de uso;
- `postgres.differingFromCandidateUrl`: URL existente diferente da candidata;
  pode ter sido curada ou customizada, não sobrescrever automaticamente;
- `postgres.sourceCandidateAbsentInDb`: URL candidata no código ausente no registro;
- `postgres.customRows`: linhas de exercícios adicionais preservadas.

Nenhum URL individual, dado pessoal, segredo nem identificador de academia
é emitido no relatório. A execução exige acesso de operador ao container do
IRON, sem conceder papéis adicionais ao usuário da academia.

## Gate de homologação

**Não declarar vídeos aprovados ou disponíveis para todos os 272 exercícios.**
O catálogo mantém candidatas e o arquivo de revisão separa a autorização
humana da existência técnica de `videoUrl`. Contagem, reprodução, técnica
correta, licenciamento, propriedade intelectual, duplicações e acessibilidade
devem ser validados individualmente por profissional autorizado.

Executar a ferramenta e registrar a saída numérica, SHA físico e data. Depois
comprovar playback Web/mobile autorizado em HOMOLOG. Apenas conteúdo que tiver
evidência de revisão e direitos deve ser classificado como aprovado.

**Estado sem execução física:** `NOT_MEASURED` — não substituir por números
da seed ou por `SUCCESS` da CI. Issue de rastreio: backend #242.
