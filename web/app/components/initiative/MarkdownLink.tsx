import { useEffect, useState } from "react";
import { Check, Copy, FileText } from "lucide-react";
import { SITE_URL } from "~/data/site";

/**
 * The initiative's markdown file: a link that opens it and a button that
 * copies its absolute URL, the handy form for handing the page to an AI.
 */
export default function MarkdownLink({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  const path = `/initiative/${slug}.md`;
  const absolute = () =>
    (typeof globalThis.location !== "undefined" ? globalThis.location.origin : SITE_URL) + path;
  return (
    <span className="ml-auto inline-flex items-center gap-3">
      <a
        className="inline-flex items-center gap-1.5 no-underline hover:underline"
        href={path}
        target="_blank"
        rel="noopener"
        title="The initiative as a markdown file, the same format the content repo uses"
      >
        <FileText className="size-[15px]" />Markdown file
      </a>
      <button
        type="button"
        className="inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-inherit hover:text-white"
        title="Copy the link to the markdown file"
        onClick={() => {
          navigator.clipboard?.writeText(absolute()).then(() => setCopied(true)).catch(() => {});
        }}
      >
        {copied
          ? <Check className="size-[15px] text-dao-green" />
          : <Copy className="size-[15px]" />}
        {copied ? "Copied" : "Copy link"}
      </button>
    </span>
  );
}
