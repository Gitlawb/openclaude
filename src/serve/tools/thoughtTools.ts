import type { ToolModule, ToolContext, VaultToolResult } from "./registry";
import { callLLM } from "./llmUtils";

const FORMATS = {
  toulmin: [
    "**Tese:** [afirmação principal]",
    "**Dados:** [evidências que suportam a tese]",
    "**Garantia:** [por que esses dados suportam a tese]",
    "**Apoio:** [respaldo adicional para a garantia]",
    "**Qualificador:** [condições, exceções e limites da tese]",
    "**Refutação:** [possíveis objeções e como respondê-las]",
  ].join("\n"),
  scqa: [
    "**Situação:** [contexto estabelecido — o que é verdade]",
    "**Complicação:** [problema ou tensão que rompe a situação]",
    "**Pergunta:** [questão central que a complicação levanta]",
    "**Resposta:** [posição ou solução proposta]",
  ].join("\n"),
  pros_contras: [
    "**Posição:** [posição clara e defensável]",
    "",
    "**Argumentos a favor:**",
    "- [razão 1]",
    "- [razão 2]",
    "",
    "**Argumentos contra:**",
    "- [objeção 1]",
    "- [objeção 2]",
    "",
    "**Síntese:** [conclusão fundamentada após pesar os dois lados]",
  ].join("\n"),
  mapa_mental: [
    "# [Ideia Central]",
    "",
    "## Dimensão 1",
    "- Ponto A",
    "- Ponto B",
    "",
    "## Dimensão 2",
    "- Ponto C",
    "- Ponto D",
    "",
    "## Conexões",
    "- [relação entre as dimensões]",
  ].join("\n"),
} as const;

type Format = keyof typeof FORMATS;
const VALID_FORMATS = Object.keys(FORMATS) as Format[];

export function thoughtToolModules(_ctx: ToolContext): ToolModule[] {
  return [structureThoughtModule, refineArgumentModule, counterArgumentModule];
}

const structureThoughtModule: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "structure_thought",
      description: "Organiza um texto livre ou pensamento disperso em um formato argumentativo estruturado. Use quando o usuário pede 'estruture', 'organize', 'formate este pensamento'. Formatos: toulmin (argumento filosófico rigoroso), scqa (pirâmide situação/complicação/pergunta/resposta), pros_contras (dois lados + síntese), mapa_mental (ideia central + ramificações).",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "O texto ou pensamento a ser estruturado" },
          format: {
            type: "string",
            enum: ["toulmin", "scqa", "pros_contras", "mapa_mental"],
            description: "Formato de estruturação a aplicar",
          },
        },
        required: ["text", "format"],
      },
    },
  },
  async run(args, _ctx): Promise<VaultToolResult> {
    const { text, format } = args as { text: string; format: string };
    if (!VALID_FORMATS.includes(format as Format)) {
      return { ok: false, content: `Formato inválido: "${format}". Use: ${VALID_FORMATS.join(", ")}` };
    }
    const template = FORMATS[format as Format];
    const prompt = [
      `Estruture o seguinte pensamento aplicando rigorosamente o formato ${format.toUpperCase()}.`,
      "",
      "Template a preencher:",
      template,
      "",
      "Texto para estruturar:",
      text,
      "",
      "Retorne APENAS o argumento estruturado preenchido, sem explicações adicionais.",
    ].join("\n");
    try {
      const content = await callLLM(prompt);
      return { ok: true, content };
    } catch (err) {
      return { ok: false, content: `Falha ao estruturar: ${String(err)}` };
    }
  },
};

const refineArgumentModule: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "refine_argument",
      description: "Refina e fortalece um argumento existente com base em instrução de melhoria. Use quando o usuário pede 'melhore', 'refine', 'deixe mais preciso', 'adicione evidências'. Mantém a estrutura do argumento original, melhora o conteúdo.",
      parameters: {
        type: "object",
        properties: {
          argument: { type: "string", description: "O argumento atual a ser refinado" },
          feedback: { type: "string", description: "Instrução de melhoria (ex: 'mais preciso', 'adicione evidências', 'elimine falácias')" },
        },
        required: ["argument", "feedback"],
      },
    },
  },
  async run(args, _ctx): Promise<VaultToolResult> {
    const { argument, feedback } = args as { argument: string; feedback: string };
    const prompt = [
      "Refine o seguinte argumento com base no feedback fornecido.",
      "",
      `Feedback: ${feedback}`,
      "",
      "Argumento atual:",
      argument,
      "",
      "Retorne APENAS o argumento refinado. Mantenha o mesmo formato e estrutura, melhore o conteúdo conforme o feedback.",
    ].join("\n");
    try {
      const content = await callLLM(prompt);
      return { ok: true, content };
    } catch (err) {
      return { ok: false, content: `Falha ao refinar: ${String(err)}` };
    }
  },
};

const counterArgumentModule: ToolModule = {
  definition: {
    type: "function",
    function: {
      name: "counter_argument",
      description: "Gera o melhor contra-argumento possível para uma posição ou argumento dado. Use quando o usuário pede 'contra-argumento', 'argumento oposto', 'como refutar', 'devil's advocate'.",
      parameters: {
        type: "object",
        properties: {
          argument: { type: "string", description: "O argumento ou posição para o qual gerar uma refutação" },
        },
        required: ["argument"],
      },
    },
  },
  async run(args, _ctx): Promise<VaultToolResult> {
    const { argument } = args as { argument: string };
    const prompt = [
      "Gere o melhor contra-argumento possível para a posição abaixo.",
      "Seja intelectualmente rigoroso — o objetivo é fortalecer o pensamento através da refutação honesta.",
      "",
      "Argumento original:",
      argument,
      "",
      "Retorne no seguinte formato:",
      "**Refutação principal:** [argumento contrário mais forte e bem fundamentado]",
      "**Evidências:** [dados, exemplos ou razões que suportam a refutação]",
      "**Ponto mais vulnerável do original:** [onde o argumento original falha ou tem premissa fraca]",
      "**Como responder a esta refutação:** [como o proponente original poderia reagir para fortalecer sua posição]",
    ].join("\n");
    try {
      const content = await callLLM(prompt);
      return { ok: true, content };
    } catch (err) {
      return { ok: false, content: `Falha ao gerar contra-argumento: ${String(err)}` };
    }
  },
};
