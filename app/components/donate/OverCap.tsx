/** Under the amount, when it is more than the initiative needs. */
export default function OverCap({ cap }: { cap: number }) {
  return (
    <p role="alert" className="m-0 ml-0.5 small text-[#ff8a88]" data-over-cap="">
      It needs ${cap.toLocaleString("en-US")} at most: that funds it fully.
    </p>
  );
}
