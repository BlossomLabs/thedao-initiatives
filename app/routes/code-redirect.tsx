import { redirect } from "react-router";
import type { Route } from "./+types/code-redirect";

/** The paper codes printed for Devcon 8 point at /devcon/<code>; test votes reuse them. */
export function clientLoader({ params }: Route.ClientLoaderArgs) {
  return redirect(`/vote/${encodeURIComponent(params.code)}`);
}

export default function CodeRedirect() {
  return null;
}
