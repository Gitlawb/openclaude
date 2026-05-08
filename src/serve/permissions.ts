export type Preset = "conservative" | "balanced" | "aggressive";

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
  requiresPreview?: boolean;
}

const READ_TOOLS = new Set(["read_note", "list_vault", "search_vault"]);
const WRITE_TOOLS = new Set(["write_note", "summarize_notes", "format_note", "suggest_links"]);
const DELETE_TOOLS = new Set(["delete_note"]);
const MOVE_TOOLS = new Set(["rename_note", "move_note"]);
const WEB_TOOLS = new Set(["web_search", "fetch_page"]);
const THINK_TOOLS = new Set(["structure_thought", "refine_argument", "counter_argument"]);

export function checkPermission(
  toolName: string,
  _args: Record<string, unknown>,
  preset: Preset,
): PermissionResult {
  // Thought tools and web read-only: always allowed regardless of preset
  if (THINK_TOOLS.has(toolName) || WEB_TOOLS.has(toolName) || READ_TOOLS.has(toolName)) {
    return { allowed: true };
  }

  // Delete: always ask (never auto-execute)
  if (DELETE_TOOLS.has(toolName)) {
    return {
      allowed: false,
      reason: `Preset "${preset}": delete operations require explicit user confirmation. Ask the user before proceeding.`,
    };
  }

  switch (preset) {
    case "conservative":
      // Writes and moves blocked — user must apply manually via diff preview
      if (WRITE_TOOLS.has(toolName) || MOVE_TOOLS.has(toolName)) {
        return {
          allowed: false,
          reason: `Preset "conservative": write and move operations are blocked. Describe the change and ask the user to apply it manually.`,
        };
      }
      return { allowed: true };

    case "balanced":
      // Writes allowed but must go through PendingEditStore (diff preview)
      if (WRITE_TOOLS.has(toolName) || MOVE_TOOLS.has(toolName)) {
        return { allowed: true, requiresPreview: true };
      }
      return { allowed: true };

    case "aggressive":
      // Writes and moves are allowed without preview requirement.
      // NOTE: auto-apply (bypassing the pending edit confirmation UI) is not yet implemented.
      // The "aggressive" preset currently differs from "balanced" only in that it allows
      // rename/move/write without setting requiresPreview:true — the pending edit flow
      // still shows a diff and requires user confirmation.
      return { allowed: true };

    default: {
      const _exhaustive: never = preset;
      return { allowed: true };
    }
  }
}
