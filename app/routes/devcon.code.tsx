import DevconPage from "~/components/devcon/DevconPage";

export function meta() {
  return [{ title: "Devcon badge · TheDAO" }, { name: "robots", content: "noindex" }];
}

/** /devcon/:code: a paper code's welcome page, then its ballot. */
export default function DevconCode() {
  return <DevconPage />;
}
