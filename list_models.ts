const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
async function listModels() {
  const url = 'https://api.githubcopilot.com/models'\;
  const headers = {
    'Authorization': `Bearer ${GITHUB_TOKEN}`,
    'Editor-Version': 'vscode/1.91.1',
    'User-Agent': 'GitHub-Copilot-Extension/1.10.0'
  };
  try {
    const response = await fetch(url, { headers });
    const data = await response.json();
    const models = Array.isArray(data) ? data : (data.data || []);
    const filtered = models.filter(m => m.id === 'claude-opus-4.5' || m.id === 'claude-sonnet-4.5' || m.id.includes('4.5'));
    console.log(JSON.stringify(filtered, null, 2));
  } catch (err) {}
}
listModels();
