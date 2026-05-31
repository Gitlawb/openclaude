/**
 * Simple i18n helper for bundled skill descriptions.
 * Reads the merged `language` setting to determine locale.
 *
 * To switch language, set `language` in your OpenClaude settings:
 *   { "language": "vietnamese" }  // or "vi"
 *   { "language": "english" }     // or "en" (default)
 */

import { getInitialSettings } from '../../utils/settings/settings.js'

type Locale = 'en' | 'vi'

export type LocalizedText = string | Record<Locale, string>

const LANGUAGE_MAP: Record<string, Locale> = {
  english: 'en',
  en: 'en',
  vietnamese: 'vi',
  vi: 'vi',
}

function detectLocale(): Locale {
  const settings = getInitialSettings()
  const lang = settings.language
  if (typeof lang !== 'string') {
    return 'en'
  }
  return LANGUAGE_MAP[lang.toLowerCase()] ?? 'en'
}

/**
 * Get a localized string from a translations map.
 * Falls back to English if the current locale is not available.
 */
export function t(translations: Record<Locale, string>): string {
  return localize(translations)
}

/**
 * Resolve a string that may already be localized text. Use at render time for
 * command metadata that must react to language changes without re-registering.
 */
export function localize(text: LocalizedText): string {
  if (typeof text === 'string') {
    return text
  }

  const locale = detectLocale()
  return text[locale] ?? text.en
}

// ─── Command description translations ───

const commandDescVi: Record<string, string> = {
  'Add a new working directory': 'Thêm thư mục làm việc mới',
  'Configure the advisor model': 'Cấu hình mô hình advisor',
  'Manage agent configurations': 'Quản lý cấu hình agent',
  'Create a branch of the current conversation at this point': 'Tạo nhánh của cuộc hội thoại tại điểm này',
  'Connect this terminal for remote-control sessions': 'Kết nối terminal này cho các phiên điều khiển từ xa',
  'Toggle brief-only mode': 'Bật/tắt chế độ tóm tắt',
  'Hatch, pet, and manage your OpenClaude companion': 'Nuôi, chăm sóc và quản lý thú cưng OpenClaude',
  'Claude in Chrome (Beta) settings': 'Cài đặt Claude trong Chrome (Beta)',
  'Clear conversation history and free up context': 'Xóa lịch sử hội thoại và giải phóng ngữ cảnh',
  'Set the prompt bar color for this session': 'Đặt màu thanh prompt cho phiên này',
  'Configure commit attribution text': 'Cấu hình văn bản ghi công commit',
  'Commit, push, and open a PR': 'Commit, push và tạo PR',
  'Create a git commit': 'Tạo git commit',
  'Open config panel': 'Mở bảng cấu hình',
  'Visualize current context usage as a colored grid': 'Hiển thị mức sử dụng ngữ cảnh dạng lưới màu',
  'Show current context usage': 'Hiện mức sử dụng ngữ cảnh',
  'Show the total cost and duration of the current session': 'Hiện tổng chi phí và thời lượng phiên hiện tại',
  'Continue the current session in Claude Desktop': 'Tiếp tục phiên hiện tại trong Claude Desktop',
  'View uncommitted changes and per-turn diffs': 'Xem thay đổi chưa commit và diff từng lượt',
  'Diagnose and verify your OpenClaude installation and settings': 'Chẩn đoán và xác minh cài đặt OpenClaude',
  'Set effort level for model usage': 'Đặt mức độ nỗ lực cho mô hình',
  'Exit the REPL': 'Thoát REPL',
  'Export the current conversation to a file or clipboard': 'Xuất cuộc hội thoại ra file hoặc clipboard',
  'Configure extra usage to keep working when limits are hit': 'Cấu hình sử dụng thêm khi đạt giới hạn',
  'List all files currently in context': 'Liệt kê tất cả file trong ngữ cảnh',
  'Dump the JS heap to ~/Desktop': 'Xuất JS heap ra ~/Desktop',
  'View hook configurations for tool events': 'Xem cấu hình hook cho sự kiện tool',
  'Manage IDE integrations and show status': 'Quản lý tích hợp IDE và hiện trạng thái',
  'Generate a report analyzing your OpenClaude sessions': 'Tạo báo cáo phân tích các phiên OpenClaude',
  'Set up Claude GitHub Actions for a repository': 'Thiết lập Claude GitHub Actions cho kho lưu trữ',
  'Install the Claude Slack app': 'Cài đặt ứng dụng Claude Slack',
  'Install OpenClaude native build': 'Cài đặt bản build gốc OpenClaude',
  'Open or create your keybindings configuration file': 'Mở hoặc tạo file cấu hình phím tắt',
  'Manage native Knowledge Graph': 'Quản lý Knowledge Graph',
  'Sign out from your Anthropic account': 'Đăng xuất khỏi tài khoản Anthropic',
  'Inspect and set up Language Server Protocol code intelligence': 'Kiểm tra và thiết lập LSP code intelligence',
  'Manage MCP servers': 'Quản lý máy chủ MCP',
  'Edit Claude memory files': 'Chỉnh sửa file bộ nhớ Claude',
  'Show QR code to download the Claude mobile app': 'Hiện mã QR để tải ứng dụng Claude mobile',
  'Deprecated: use /config to change output style': 'Đã ngừng sử dụng: dùng /config để đổi kiểu output',
  'Manage allow & deny tool permission rules': 'Quản lý quy tắc cho phép & từ chối tool',
  'Enable plan mode or view the current session plan': 'Bật chế độ kế hoạch hoặc xem kế hoạch phiên hiện tại',
  'Manage OpenClaude plugins': 'Quản lý plugin OpenClaude',
  'Get comments from a GitHub pull request': 'Lấy bình luận từ pull request GitHub',
  'View and update your privacy settings': 'Xem và cập nhật cài đặt quyền riêng tư',
  'Manage API provider profiles': 'Quản lý hồ sơ nhà cung cấp API',
  'Show options when rate limit is reached': 'Hiện tùy chọn khi đạt giới hạn tốc độ',
  'View release notes': 'Xem ghi chú phát hành',
  'Activate pending plugin changes in the current session': 'Kích hoạt thay đổi plugin đang chờ trong phiên hiện tại',
  'Configure the default remote environment for teleport sessions': 'Cấu hình môi trường từ xa mặc định cho phiên teleport',
  'Rename the current conversation': 'Đổi tên cuộc hội thoại hiện tại',
  'Show estimated request context load and top contributors': 'Hiện tải ngữ cảnh ước tính và các thành phần chính',
  'Resume a previous conversation': 'Tiếp tục cuộc hội thoại trước',
  'Review a pull request': 'Đánh giá pull request',
  'Show remote session URL and QR code': 'Hiện URL và mã QR phiên từ xa',
  'List available skills': 'Liệt kê các kỹ năng có sẵn',
  'Show your OpenClaude usage statistics and activity': 'Hiện thống kê sử dụng và hoạt động OpenClaude',
  'Order OpenClaude stickers': 'Đặt mua sticker OpenClaude',
  'Toggle a searchable tag on the current session': 'Bật/tắt thẻ tìm kiếm trên phiên hiện tại',
  'List and manage background tasks': 'Liệt kê và quản lý tác vụ nền',
  'Change the theme': 'Đổi giao diện',
  'Play the thinkback animation': 'Phát hoạt ảnh thinkback',
  'Your 2025 OpenClaude Year in Review': 'Tổng kết năm 2025 OpenClaude của bạn',
  'Upgrade to Max for higher rate limits and more Opus': 'Nâng cấp lên Max để có giới hạn tốc độ cao hơn và thêm Opus',
  'Show plan usage limits': 'Hiện giới hạn sử dụng gói',
  'Toggle between Vim and Normal editing modes': 'Chuyển đổi giữa chế độ Vim và Normal',
  'Toggle voice mode': 'Bật/tắt chế độ giọng nói',
  'Initialize and inspect the OpenClaude project wiki': 'Khởi tạo và kiểm tra wiki dự án OpenClaude',
  'Switch Anthropic accounts': 'Chuyển tài khoản Anthropic',
  'Sign in with your Anthropic account': 'Đăng nhập bằng tài khoản Anthropic',
  'Restore the code and/or conversation to a previous point': 'Khôi phục mã và/hoặc cuộc hội thoại về điểm trước',
  'Submit feedback about OpenClaude': 'Gửi phản hồi về OpenClaude',
  'Show help and available commands': 'Hiện trợ giúp và các lệnh có sẵn',
  'Interactive setup for GitHub Copilot: OAuth device login stored in secure storage': 'Thiết lập tương tác cho GitHub Copilot: đăng nhập OAuth lưu trong secure storage',
  'Default - trusted network access': 'Mặc định - truy cập mạng đáng tin cậy',
  'Faster Codex Spark tool loop profile': 'Profile Codex Spark tool loop nhanh hơn',
  'GPT-5.4 with higher reasoning on the Codex backend': 'GPT-5.4 với lý luận nâng cao trên backend Codex',
  'OpenAI and similar OpenAI-compatible APIs': 'OpenAI và các API tương thích OpenAI',
  'Prefer coding-oriented local models or GPT-4o defaults': 'Ưu tiên mô hình local chuyên code hoặc GPT-4o mặc định',
  'Prefer faster local models or gpt-4o-mini defaults': 'Ưu tiên mô hình local nhanh hơn hoặc gpt-4o-mini mặc định',
  'Remove .openclaude-profile.json and return to normal startup': 'Xóa .openclaude-profile.json và quay lại khởi động bình thường',
  'Strong everyday default for most users': 'Mặc định mạnh mẽ hàng ngày cho hầu hết người dùng',
  'Use Gemini with API key, access token, or local ADC': 'Dùng Gemini với API key, access token, hoặc local ADC',
  'Use existing ChatGPT Codex CLI auth or env credentials': 'Dùng xác thực ChatGPT Codex CLI hoặc biến môi trường hiện có',
  'Ask a quick side question without interrupting the main conversation': 'Đặt câu hỏi nhanh bên lề mà không làm gián đoạn cuộc hội thoại chính',
  'Clear conversation history but keep a summary in context. Optional: /compact [instructions for summarization]': 'Xóa lịch sử hội thoại nhưng giữ tóm tắt trong ngữ cảnh. Tùy chọn: /compact [hướng dẫn tóm tắt]',
  'Complete a security review of the pending changes on the current branch': 'Hoàn thành đánh giá bảo mật cho các thay đổi đang chờ trên nhánh hiện tại',
  'Configure auto-fix: run lint/test after AI edits': 'Cấu hình tự động sửa: chạy lint/test sau khi AI chỉnh sửa',
  'Copy Claude': 'Sao chép Claude',
  'Create verifier skill(s) for automated verification of code changes': 'Tạo skill xác minh để tự động kiểm tra thay đổi code',
  'Generate your personalized animation': 'Tạo hoạt ảnh cá nhân hóa của bạn',
  'Inject bridge failure states for manual recovery testing': 'Chèn trạng thái lỗi bridge để kiểm thử khôi phục thủ công',
  'Print the version this session is running (not what autoupdate downloaded)': 'In phiên bản mà phiên này đang chạy (không phải phiên bản tự động cập nhật đã tải)',
  'Provider: OpenRouter': 'Nhà cung cấp: OpenRouter',
  'Run memory consolidation — synthesize recent sessions into durable memories': 'Chạy hợp nhất bộ nhớ — tổng hợp các phiên gần đây thành bộ nhớ lâu dài',
  'Send identical requests to test prompt caching (results in debug log)': 'Gửi các yêu cầu giống hệt nhau để kiểm thử bộ nhớ đệm prompt (kết quả trong debug log)',
  'Set up OpenClaude': 'Thiết lập OpenClaude',
  'Setup OpenClaude on the web (requires connecting your GitHub account)': 'Thiết lập OpenClaude trên web (yêu cầu kết nối tài khoản GitHub)',
  'Show OpenClaude status including version, model, account, API connectivity, and tool statuses': 'Hiển thị trạng thái OpenClaude bao gồm phiên bản, mô hình, tài khoản, kết nối API và trạng thái công cụ',
  'Show per-turn and session cache hit/miss stats (works across all providers)': 'Hiển thị thống kê cache hit/miss theo lượt và phiên (hoạt động trên tất cả nhà cung cấp)',
  'Skip this picker in the future (revert via /config)': 'Bỏ qua bộ chọn này trong tương lai (hoàn tác qua /config)',
}

/**
 * Translate a command description to the current locale.
 * Falls back to the original English string if no translation exists.
 */
export function translateCommandDescription(englishDesc: string): string {
  if (detectLocale() !== 'vi') return englishDesc
  return commandDescVi[englishDesc] ?? englishDesc
}
