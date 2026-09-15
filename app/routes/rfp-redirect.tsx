import { redirect } from "react-router";
import type { Route } from "./+types/rfp-redirect";

/** The MVP's old URL scheme; shared links keep working. */
export function clientLoader({ params }: Route.ClientLoaderArgs) {
  return redirect(`/initiative/${params.slug}`);
}

export default function RfpRedirect() {
  return null;
}
