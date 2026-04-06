# Como contribuir com o OpenClaude

Obrigado por querer contribuir 🎉

## Antes de começar

- Leia `README.md` para setup básico.
- Consulte `PLAYBOOK.md` para fluxo operacional.
- Verifique se já existe issue/PR semelhante.

## Setup local

```bash
git clone <repo>
cd openclaude
bun install
bun run build
```

## Fluxo de desenvolvimento

1. Crie uma branch de feature/bugfix.
2. Faça alterações pequenas e focadas.
3. Rode testes/checks localmente.
4. Abra PR com contexto claro.

## Validação

Execute sempre que possível:

```bash
bun run test
bun run typecheck
bun run lint
```

## Pull Requests

Inclua:

- Resumo objetivo da mudança.
- Motivação e impacto.
- Como validar.
- Prints/logs quando relevante.

## Estilo de código

- Priorize clareza e simplicidade.
- Evite mudanças não relacionadas no mesmo PR.
- Mantenha consistência com padrões existentes.

## Mudanças de provedor

Ao alterar integração com provedores:

- Documente variáveis exigidas.
- Inclua fallback/erros amigáveis.
- Atualize guias em `docs/`.

## Comunidade

Siga o `CODE_OF_CONDUCT.md` em toda interação do projeto.
