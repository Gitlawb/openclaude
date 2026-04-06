# Extensão OpenClaude para VS Code

Integra o OpenClaude ao VS Code para facilitar uso da CLI no fluxo de desenvolvimento.

## Recursos

- Comandos rápidos para abrir/operar o OpenClaude.
- Detecção de estado da sessão.
- Atalhos para tarefas comuns de interação.

## Requisitos

- VS Code atualizado.
- OpenClaude instalado no sistema (`openclaude` no PATH).

## Comandos

- Iniciar OpenClaude
- Abrir painel/terminal da extensão
- Atualizar estado da sessão

## Configurações

A extensão pode expor configurações para caminho do binário e comportamento da sessão.

## Notas sobre detecção de status

A detecção depende da disponibilidade do processo CLI e do ambiente local do VS Code.

## Desenvolvimento

```bash
npm install
npm test
```

Use o modo de extensão em desenvolvimento do VS Code para validar mudanças.
