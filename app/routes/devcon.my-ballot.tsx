import DevconPage from "~/components/devcon/DevconPage";

export function meta() {
  return [{ title: "Your Devcon ballot · TheDAO" }, { name: "robots", content: "noindex" }];
}

/** /devcon/my-ballot: the signed-in account's ballot, found by its badge (no code). */
export default function MyBallot() {
  return <DevconPage myBallot />;
}
