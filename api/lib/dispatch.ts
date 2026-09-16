import type { Hono } from "hono";
import type { Vars } from "../middleware/context.ts";

/** Preserve the runtime's socket metadata when routing a request into Hono. */
export function dispatchApi(
  app: Pick<Hono<Vars>, "fetch">,
  request: Request,
  info: Deno.ServeHandlerInfo<Deno.NetAddr>,
): Response | Promise<Response> {
  return app.fetch(request, info);
}
