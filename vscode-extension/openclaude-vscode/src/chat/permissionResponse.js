/**
 * Build SDK can_use_tool control_response payloads for the VS Code chat host.
 */

/**
 * @param {'allow' | 'deny' | 'allow-session'} action
 * @param {{
 *   input?: Record<string, unknown> | null,
 *   toolUseId?: string | null,
 *   permissionSuggestions?: unknown[] | null,
 * }} ctx
 */
function buildPermissionControlResult(action, ctx = {}) {
  const toolUseID = ctx.toolUseId || undefined;
  const input =
    ctx.input && typeof ctx.input === 'object' && !Array.isArray(ctx.input)
      ? ctx.input
      : {};

  if (action === 'deny') {
    return {
      behavior: 'deny',
      message: 'User denied permission',
      toolUseID,
    };
  }

  const result = {
    behavior: 'allow',
    updatedInput: input,
    toolUseID,
  };

  if (action === 'allow-session') {
    const suggestions = Array.isArray(ctx.permissionSuggestions)
      ? ctx.permissionSuggestions
      : [];
    if (suggestions.length > 0) {
      result.updatedPermissions = suggestions;
    }
  }

  return result;
}

module.exports = { buildPermissionControlResult };
