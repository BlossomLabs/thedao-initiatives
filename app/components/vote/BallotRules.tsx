/** Why this ballot can't be sent yet: each broken ballot rule, in plain words. */
export default function BallotRules({ messages }: { messages: string[] }) {
  return (
    <section
      aria-label="Ballot rules"
      className="rounded-xl border border-amber-300/40 bg-amber-300/[.08] p-4"
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
