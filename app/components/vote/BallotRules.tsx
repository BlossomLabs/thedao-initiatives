/** Why this ballot can't be sent yet: each broken ballot rule, in plain words. */
export default function BallotRules({ messages }: { messages: string[] }) {
  return (
    <section
      aria-label="Ballot rules"
      data-ballot-reason=""
      // The marked cards' red (#144): it blocks sending, and it points at them. Light, as
      // the round box's amber note is.
      className="rounded-xl border border-dao-red-pale/40 bg-dao-red-pale/[.08] p-4"
    >
      <p className="font-inter-tight text-[14px] font-semibold text-white">
        This ballot can't be sent yet
      </p>
      <ul className="mt-2 space-y-1.5 text-[13.5px] leading-snug text-white/80">
        {messages.map((m) => <li key={m}>{m}</li>)}
      </ul>
    </section>
  );
}
