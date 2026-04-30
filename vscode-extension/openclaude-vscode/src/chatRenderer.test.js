const test = require('node:test');
const assert = require('node:assert/strict');
const { renderChatHtml } = require('./chat/chatRenderer');
const { SLASH_COMMANDS } = require('./chat/slashCommands');

test('renderChatHtml includes slash command palette UI and command data', () => {
  const html = renderChatHtml({
    nonce: 'test-nonce',
    platform: 'darwin',
    slashCommands: SLASH_COMMANDS,
  });

  assert.match(html, /id="slashPalette"/);
  assert.match(html, /const slashCommands = /);
  assert.match(html, /"name":"clear"/);
  assert.match(html, /"name":"context"/);
  assert.match(html, /acceptSlashCommand/);
});

test('renderChatHtml keeps the unfiltered slash palette uncapped', () => {
  const html = renderChatHtml({
    nonce: 'test-nonce',
    platform: 'darwin',
    slashCommands: SLASH_COMMANDS,
  });

  assert.match(html, /return normalized \? matches\.slice\(0, 24\) : matches;/);
});

test('renderChatHtml escapes slash command JSON for inline script safety', () => {
  const html = renderChatHtml({
    nonce: 'test-nonce',
    platform: 'linux',
    slashCommands: [
      {
        name: 'unsafe',
        description: '</script><script>boom()</script>',
      },
    ],
  });

  assert.doesNotMatch(html, /<\/script><script>boom\(\)<\/script>/);
  assert.match(html, /\\u003c\/script\\u003e\\u003cscript\\u003eboom\(\)\\u003c\/script\\u003e/);
});
