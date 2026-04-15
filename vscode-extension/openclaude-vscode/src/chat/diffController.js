/**
 * diffController — provides a TextDocumentContentProvider for virtual
 * diff documents and helpers to open VS Code's native diff editor when
 * tool use involves file edits.
 */

const vscode = require('vscode');

const SCHEME = 'openclaude-diff';
let contentStore = new Map();

class DiffContentProvider {
  constructor() {
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChange = this._onDidChange.event;
  }

  provideTextDocumentContent(uri) {
    return contentStore.get(uri.toString()) || '';
  }

  update(uri) {
    this._onDidChange.fire(uri);
  }

  dispose() {
    this._onDidChange.dispose();
  }
}

function storeContent(id, content) {
  const uri = vscode.Uri.parse(`${SCHEME}:/${id}`);
  contentStore.set(uri.toString(), content);
  return uri;
}

function clearContent(id) {
  const uri = vscode.Uri.parse(`${SCHEME}:/${id}`);
  contentStore.delete(uri.toString());
}

function clearAll() {
  contentStore.clear();
}

/**
 * Opens a diff view between original and modified content.
 * @param {object} opts
 * @param {string} opts.filePath - Display path (for the title)
 * @param {string} opts.original - Original file content
 * @param {string} opts.modified - Modified file content
 * @param {string} [opts.toolUseId] - Unique ID for this diff
 */
async function openDiff({ filePath, original, modified, toolUseId }) {
  const id = toolUseId || Math.random().toString(36).slice(2, 10);
  const originalUri = storeContent(`original-${id}`, original || '');
  const modifiedUri = storeContent(`modified-${id}`, modified || '');
  const shortName = filePath ? filePath.split(/[\\/]/).pop() : 'file';
  const title = `${shortName} (OpenClaude Diff)`;

  await vscode.commands.executeCommand('vscode.diff', originalUri, modifiedUri, title);
}

/**
 * Opens a diff between a real file on disk and modified content from
 * a tool use result.
 * @param {object} opts
 * @param {string} opts.filePath - Absolute path to the real file
 * @param {string} opts.modified - Modified content
 * @param {string} [opts.toolUseId]
 */
async function openFileDiff({ filePath, modified, toolUseId }) {
  const id = toolUseId || Math.random().toString(36).slice(2, 10);
  const fileUri = vscode.Uri.file(filePath);
  const modifiedUri = storeContent(`modified-${id}`, modified || '');
  const shortName = filePath.split(/[\\/]/).pop() || 'file';
  const title = `${shortName} (OpenClaude Edit)`;

  await vscode.commands.executeCommand('vscode.diff', fileUri, modifiedUri, title);
}

module.exports = {
  DiffContentProvider,
  SCHEME,
  openDiff,
  openFileDiff,
  storeContent,
  clearContent,
  clearAll,
};
