import { registerBundledSkill } from '../bundledSkills.js'

const PDF_SKILL_PROMPT = `# PDF Generation Skill

Generate PDF files from various input formats and content.

## Capabilities

This skill allows you to create PDF files using a dedicated PDF generation tool. The underlying implementation uses a Rust-based PDF generator for performance and reliability.

## Usage

The PDF skill supports the following operations:

1. **Convert text/markdown to PDF**:
   - Create PDFs from plain text content
   - Convert Markdown documents to formatted PDFs
   - Support for basic formatting (headings, lists, code blocks)

2. **Generate reports**:
   - Create structured reports with tables
   - Include charts and diagrams (as embedded images)
   - Support for headers, footers, and page numbers

3. **Manipulate existing PDFs**:
   - Merge multiple PDF files
   - Split PDF files into smaller sections
   - Add watermarks or annotations

## Implementation Details

The PDF generation is handled by a Rust-based tool that is called via the Bash tool. The Rust tool is responsible for:
- Parsing input content (text, markdown, HTML)
- Applying styling and formatting
- Generating properly formatted PDF files
- Handling image embedding and layout

## Workflow

When a user requests PDF creation:

1. **Analyze the request** - Determine the input format and desired output
2. **Prepare content** - Format the content appropriately for PDF conversion
3. **Call PDF generation tool** - Use the Bash tool to execute the Rust PDF generator
4. **Verify output** - Confirm the PDF was created successfully
5. **Return result** - Inform the user of the PDF location

## Available Commands

The underlying Rust tool supports these commands:
- \`pdfgen text <input_file> <output_file>\` - Convert plain text to PDF
- \`pdfgen markdown <input_file> <output_file>\` - Convert Markdown to PDF
- \`pdfgen html <input_file> <output_file>\` - Convert HTML to PDF
- \`pdfgen merge <input_files...> <output_file>\` - Merge multiple PDFs
- \`pdfgen split <input_file> <output_dir>\` - Split a PDF into individual pages

## Example Usage

User: "Create a PDF report from this document"
1. Identify the source content
2. Prepare it for PDF conversion
3. Execute: \`pdfgen markdown source.md report.pdf\`
4. Verify the PDF was created at report.pdf

User: "Combine these PDF files into one"
1. Identify the input PDF files
2. Execute: \`pdfgen merge file1.pdf file2.pdf combined.pdf\`
3. Verify the combined PDF was created

## Important Notes

- The Rust PDF generation tool must be installed and available in the PATH
- Large documents may take some time to process
- Images and complex layouts may require preprocessing
- The tool supports common fonts; custom fonts may need to be specified separately
`

export function registerPdfSkill(): void {
  registerBundledSkill({
    name: 'pdf',
    description: 'Generate PDF files from various input formats including text, markdown, and HTML. Also supports merging, splitting, and manipulating existing PDF files.',
    argumentHint: '[operation] [input] [output]',
    userInvocable: true,
    allowedTools: ['Bash', 'Read', 'Write', 'Edit'],
    async getPromptForCommand(args) {
      let prompt = PDF_SKILL_PROMPT

      if (args) {
        prompt += `\n\n## User Request\n\n${args}`
        prompt += `\n\n## Task\n\nBased on the user's request, help them create the desired PDF. Identify the input format, determine the appropriate PDF generation command, and execute it using the Bash tool.`
      }

      return [{ type: 'text', text: prompt }]
    },
  })
}