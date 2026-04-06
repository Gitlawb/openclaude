# OpenClaude no Android (Termux)

Guia para rodar OpenClaude em Android usando Termux + Ubuntu (proot).

## Pré-requisitos

- Android com Termux instalado.
- Espaço livre suficiente (dependências + modelos, se local).
- Internet para baixar pacotes.

## Por que esse setup?

- Melhora compatibilidade de ferramentas Linux.
- Facilita instalação de runtimes modernos.
- Isola ambiente para desenvolvimento.

## Instalação

### 1) Atualize o Termux

```bash
pkg update && pkg upgrade -y
```

### 2) Instale dependências

```bash
pkg install -y git curl proot-distro
```

### 3) Clone o OpenClaude

```bash
git clone <repo>
cd openclaude
```

### 4) Instale Ubuntu via proot

```bash
proot-distro install ubuntu
proot-distro login ubuntu
```

### 5) Instale Bun no Ubuntu

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
```

### 6) Build do OpenClaude

```bash
bun install
bun run build
```

### 7) Salve variáveis de ambiente

Adicione `OPENAI_API_KEY`, `OPENAI_BASE_URL` e `OPENAI_MODEL` no `~/.bashrc` do Ubuntu quando necessário.

### 8) Execute o OpenClaude

```bash
openclaude
```

## Reiniciar após fechar Termux

1. Abrir Termux
2. `proot-distro login ubuntu`
3. `cd openclaude`
4. Executar OpenClaude

## Modelo gratuito recomendado

- Use Ollama/local apenas se o hardware suportar.
- Caso contrário, use provedores cloud com camadas gratuitas.

## Alternativas gratuitas (OpenRouter)

Modelos e disponibilidade variam com frequência; revise catálogo atual antes de definir perfil padrão.

## Por que não Groq ou Cerebras (em alguns casos)?

Pode haver limites regionais, quotas ou mudanças de plano que afetam previsibilidade de uso gratuito.

## Dicas

- Evite encerrar processos críticos durante downloads/build.
- Use sessões tmux/screen quando disponível.
- Faça backup das variáveis e do perfil local.
