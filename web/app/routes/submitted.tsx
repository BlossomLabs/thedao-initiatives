import { Link, useLocation } from "react-router";
import PageMain from "~/components/layout/PageMain";
import { generateMeta } from "~/utils/meta";

export function meta() {
  return generateMeta({ title: "Thank you", url: "/submit/thanks", noIndex: true });
}

export default function Submitted() {
  const title = (useLocation().state as { title?: string } | null)?.title;
  return (
    <PageMain narrow detail center className="min-h-[50vh]">
      <h1 className="m-0 font-inter-tight text-[clamp(26px,4vw,40px)] font-medium tracking-[-.02em]">
        Thank you
      </h1>
      <p className="mt-3.5 font-inter-tight text-[15px] font-light leading-[1.65] text-muted">
        {title ? <b className="text-white">{title}</b> : "Your initiative"}{" "}
        is in the review queue. Once an admin approves it, it will appear on the initiatives board
        and can start collecting pledges and donations.
      </p>
      <p>
        <Link className="btn" to="/">Back to the board</Link>
      </p>
    </PageMain>
  );
}
