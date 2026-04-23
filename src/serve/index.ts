import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";

export type ServerOpts = {
  port?: number;
  projectDir?: string;
};

export type ServerHandle = {
  url: string;
  port: number;
  token: string;
  stop: () => Promise<void>;
};

export async function startServer(opts: ServerOpts): Promise<ServerHandle> {
  const token = randomBytes(32).toString("hex");
  const server: Server = createServer((_req, res) => {
    res.writeHead(501);
    res.end("Not implemented");
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Failed to bind");
  const port = addr.port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    token,
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}
