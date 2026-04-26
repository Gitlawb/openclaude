import { readGithubModelsTokenAsync } from './src/utils/model/githubModels';
async function test() {
  const token = process.env.GITHUB_MODELS_TOKEN || await readGithubModelsTokenAsync();
  if (!token) { console.error("Token not found"); return; }
  const url = "https://api.githubcopilot.com/models"\;
  const hBase = { "Accept": "application/json", "Authorization": "Bearer " + token };
  console.log("--- Request A (version header) ---");
  try {
    const rA = await fetch(url, { headers: { ...hBase, "X-GitHub-Api-Version": "2026-03-10" } });
    const bA = await rA.text();
    console.log("Status:", rA.status);
    console.log("Body:", bA.substring(0, 200));
  } catch (e) { console.error(e); }
  console.log("\n--- Request B (no version header) ---");
  try {
    const rB = await fetch(url, { headers: hBase });
    const bB = await rB.text();
    console.log("Status:", rB.status);
    console.log("Body:", bB.substring(0, 200));
  } catch (e) { console.error(e); }
}
test();
