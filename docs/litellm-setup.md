# Configuração do LiteLLM com OpenClaude

## Visão geral

LiteLLM permite padronizar acesso a múltiplos provedores via um proxy compatível com OpenAI.

## Pré-requisitos

- Python instalado.
- LiteLLM disponível no ambiente.
- OpenClaude instalado.

## 1) Inicie o proxy LiteLLM

### Instalação básica

```bash
pip install litellm
```

### Exemplo de configuração (`litellm_config.yaml`)

```yaml
model_list:
  - model_name: gpt-4o-mini
    litellm_params:
      model: openai/gpt-4o-mini
      api_key: os.environ/OPENAI_API_KEY
```

### Rodar proxy

```bash
litellm --config litellm_config.yaml --port 4000
```

## 2) Aponte o OpenClaude para o LiteLLM

### Opção A: Variáveis de ambiente

```bash
export OPENAI_BASE_URL="http://127.0.0.1:4000/v1"
export OPENAI_API_KEY="qualquer_valor_ou_master_key"
export OPENAI_MODEL="gpt-4o-mini"
openclaude
```

### Opção B: comando `/provider`

Dentro do OpenClaude, altere provedor/modelo para usar o endpoint do proxy.

## 3) Exemplo com roteamento multi-provedor

Você pode definir múltiplos modelos no `model_list`, com regras de custo, fallback e limites de gasto.

## 4) Notas

- Quando houver `master key`, use a mesma chave no cliente OpenClaude.
- Garanta que o endpoint esteja no formato `/v1` para compatibilidade.

## 5) Troubleshooting

- `401`/`403`: revise chaves e permissões.
- `404`: confirme rota `/v1/chat/completions`.
- Timeout: valide porta, firewall e DNS.

## 6) Recursos

- Documentação oficial do LiteLLM
- Documentação de provedores usados no seu `config`
