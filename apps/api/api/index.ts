import type { Request, Response } from "express";
import { createApp } from "../src/main";

let serverPromise: Promise<(req: Request, res: Response) => void> | undefined;

async function getServer() {
  if (!serverPromise) {
    serverPromise = createApp().then(async (app) => {
      await app.init();
      return app.getHttpAdapter().getInstance() as (req: Request, res: Response) => void;
    });
  }
  return serverPromise;
}

export default async function handler(req: Request, res: Response) {
  const server = await getServer();
  return server(req, res);
}
