export default function Shimmer({ soft }: { soft?: boolean }) {
  return <hr className={soft ? "shimmer shimmer-soft" : "shimmer"} />;
}
