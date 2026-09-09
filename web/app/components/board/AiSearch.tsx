import { useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { api, errorMessage } from "~/lib/api";
import { Button } from "~/components/ui/Button";

/** "Show top matches": the LLM ranks initiatives; only the order changes, client-side. */
export default function AiSearch({ onMatches }: { onMatches: (ids: string[] | null) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<React.ReactNode>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const query = q.trim();
    if (query.length < 3) {
      setNote("Describe what you want to fund in a few words.");
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const { matches } = await api<{ matches: string[] }>("/api/ai-search", {
        json: { query },
        token: null,
      });
      onMatches(matches);
      setNote(
        matches.length
          ? (
            <>
              Top matches moved to the front.{" "}
              <button
                type="button"
                className="cursor-pointer border-0 bg-transparent p-0 text-dao-green underline"
                onClick={() => {
                  onMatches(null);
                  setNote(null);
                }}
              >
                Show the default order
              </button>
            </>
          )
          : "No clear matches; showing everything.",
      );
    } catch (err) {
      setNote(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Figma: 51px input (14px radius, white/5 fill, white/10 border, 18px icon 16px in,
  // 44px left padding) + 51px red button, 10px apart, 20px above the cards.
  return (
    <>
      <form className="mb-5 mt-1 flex flex-wrap gap-2.5" autoComplete="off" onSubmit={run}>
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-white/45" />
          <input
            className="field border-white/10 pl-11 placeholder:text-white/25"
            maxLength={300}
            placeholder="What kind of security work do you want to fund? Describe it and we'll surface the best matches."
            aria-label="Describe the security work you want to fund"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button variant="primary" type="submit" loading={busy}>
          Show top matches <ArrowRight className="size-4" />
        </Button>
      </form>
      {note && <p className="-mt-2 mb-[18px] small dim">{note}</p>}
    </>
  );
}
