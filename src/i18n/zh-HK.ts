export const zhHK = {
  // common
  "common.ok": "確定",
  "common.cancel": "取消",
  "common.back": "返回",
  "common.continue": "繼續",
  "common.save": "儲存",
  "common.delete": "刪除",
  "common.edit": "編輯",
  "common.loading": "載入中...",
  "common.success": "成功",
  "common.failed": "失敗",
  "common.yes": "是",
  "common.no": "否",
  "common.options": "選項",
  "common.shortcut_hint": "按 Enter 繼續，按 Esc 返回",

  // commands
  "commands.provider.description": "開啟服務商設定選單與切換設定檔",
  "commands.model.description": "即時切換當前會話使用的 AI 模型",
  "commands.onboard_github.description": "引導設定 GitHub Models 憑證與登入",
  "commands.buddy.description": "呼喚或設定 Terminal 像素夥伴",
  "commands.repomap.description": "檢視程式庫結構圖與權重排名",
  "commands.btw.description": "發送側邊問題而不打斷主對話 context",
  "commands.usage.description": "顯示當前 API 用量與 Token 消費",
  "commands.help.description": "顯示 OpenClaude 指令與快捷鍵指南",

  // provider
  "provider.title": "設定服務商 Profile",
  "provider.select_method": "請選擇登入或連線方式：",
  "provider.options.subscription": "Claude 訂閱帳戶（Pro / Team / Enterprise）",
  "provider.options.console": "Anthropic Console API 帳戶",
  "provider.options.third_party": "第三方平台（OpenAI、Gemini、DeepSeek、Ollama 等）",
  "provider.presets.title": "選擇預設服務商預設檔：",
  "provider.presets.gitlawb": "Gitlawb Opengateway（預設推薦，免 VPN）",
  "provider.presets.deepseek": "DeepSeek 原生 API",
  "provider.presets.aimlapi": "AI/ML API (1,000+ 模型網關)",
  "provider.presets.ollama": "Ollama 本地模型服務",
  "provider.enter_key": "請輸入 API Key：",
  "provider.invalid_key": "無效的 API Key，請重新輸入。",
  "provider.saved": "服務商設定已成功儲存至 ~/.openclaude-profile.json",

  // model
  "model.current_model": "當前模型：",
  "model.select_prompt": "請輸入或選擇模型 ID（例如：mimo-v2.5-pro、google/gemini-1.5-pro）：",
  "model.custom_input": "自訂模型 ID",
  "model.switched_success": "成功切換模型至 {{model}}",

  // errors
  "errors.node_not_found": "找不到 Node.js 執行檔，請確認 WSL / Bash PATH 設定。",
  "errors.unsupported_region": "直接 Anthropic 連線受地區限制，建議於 /provider 切換至 Gitlawb Opengateway 或 DeepSeek。",
  "errors.api_401": "API 驗證失敗 (401)，請檢查 API Key 是否正確。",
  "errors.api_429": "請求過於頻繁 (429 Rate Limit)，請稍後再試。",

  // prompts
  "prompts.input_placeholder": "輸入提示詞或指令（/ 呼叫選單，! 執行 Bash，@ 引入檔案）...",
  "prompts.bash_mode": "[Bash 模式] 輸入 Shell 指令...",
  "prompts.side_question": "[/btw 側邊問題] 不會干擾當前主會話上下文..."
};

export default zhHK;
