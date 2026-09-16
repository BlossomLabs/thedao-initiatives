/** TheDAO Security Fund — RFP board API on its own (dev). The deployed site
 * serves API and web together from `../server.ts`. */
import { createServer } from "./bootstrap.ts";
import { dispatchApi } from "./lib/dispatch.ts";

const { app, config } = await createServer();
Deno.serve({ port: config.port }, (req, info) => dispatchApi(app, req, info));
