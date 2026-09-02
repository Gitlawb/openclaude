export const en = {
  // common
  "common.ok": "OK",
  "common.cancel": "Cancel",
  "common.back": "Back",
  "common.continue": "Continue",
  "common.save": "Save",
  "common.delete": "Delete",
  "common.edit": "Edit",
  "common.loading": "Loading...",
  "common.success": "Success",
  "common.failed": "Failed",
  "common.yes": "Yes",
  "common.no": "No",
  "common.options": "Options",
  "common.shortcut_hint": "Press Enter to continue, Esc to go back",

  // commands
  "commands.provider.description": "Open provider menu and switch profiles",
  "commands.model.description": "Switch AI model for current session",
  "commands.onboard_github.description": "Configure GitHub Models credentials",
  "commands.buddy.description": "Summon or configure Terminal Pixel Buddy",
  "commands.repomap.description": "View repository structure map and rank weights",
  "commands.btw.description": "Send side questions without breaking main chat context",
  "commands.usage.description": "Show API usage and token consumption",
  "commands.help.description": "Show OpenClaude commands and shortcut guide",

  // provider
  "provider.title": "Configure Provider Profile",
  "provider.select_method": "Select login or connection method:",
  "provider.options.subscription": "Claude Subscription (Pro / Team / Enterprise)",
  "provider.options.console": "Anthropic Console API Account",
  "provider.options.third_party": "Third-party platform (OpenAI, Gemini, DeepSeek, Ollama, etc.)",
  "provider.presets.title": "Select default provider preset:",
  "provider.presets.gitlawb": "Gitlawb Opengateway (Recommended)",
  "provider.presets.deepseek": "DeepSeek Native API",
  "provider.presets.aimlapi": "AI/ML API",
  "provider.presets.ollama": "Ollama Local Service",
  "provider.enter_key": "Enter API Key:",
  "provider.invalid_key": "Invalid API Key, please re-enter.",
  "provider.saved": "Provider settings saved to ~/.openclaude-profile.json",

  // model
  "model.current_model": "Current Model:",
  "model.select_prompt": "Enter or select Model ID:",
  "model.custom_input": "Custom Model ID",
  "model.switched_success": "Switched model to {{model}}",

  // errors
  "errors.node_not_found": "Node.js executable not found.",
  "errors.unsupported_region": "Direct Anthropic connection restricted in this region.",
  "errors.api_401": "API Authentication failed (401).",
  "errors.api_429": "Rate limit exceeded (429).",

  // prompts
  "prompts.input_placeholder": "Type prompt or command...",
  "prompts.bash_mode": "[Bash Mode] Type shell command...",
  "prompts.side_question": "[/btw Side Question] Will not disrupt current session context..."
};

export default en;
