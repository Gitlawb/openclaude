import { startServer } from "../../serve/index";

export async function serveCommand(args: string[]): Promise<void> {
  const portIdx = args.indexOf("--port");
  const port = portIdx >= 0 ? parseInt(args[portIdx + 1]!, 10) : 0;
  const projectIdx = args.indexOf("--project-dir");
  const projectDir = projectIdx >= 0 ? args[projectIdx + 1] : undefined;
  const server = await startServer({ port, projectDir });
  const info = { type: "server-started", url: server.url, port: server.port, token: "***redacted***" };
  console.log(JSON.stringify(info));
  const shutdown = async () => { await server.stop(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
