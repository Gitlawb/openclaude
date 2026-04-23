import { startServer } from "../../serve/index";

export async function serveCommand(args: string[]): Promise<void> {
  const portIdx = args.indexOf("--port");
  const parsedPort = portIdx >= 0 ? parseInt(args[portIdx + 1] ?? "", 10) : 0;
  const port = Number.isFinite(parsedPort) && parsedPort >= 0 ? parsedPort : 0;
  const projectIdx = args.indexOf("--project-dir");
  const projectDir = projectIdx >= 0 ? args[projectIdx + 1] : undefined;
  const server = await startServer({ port, projectDir });
  const info = { type: "server-started", url: server.url, port: server.port, token: "***redacted***" };
  console.log(JSON.stringify(info));
  const shutdown = async () => { await server.stop(); process.exit(0); };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
