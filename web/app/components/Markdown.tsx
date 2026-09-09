import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { cn } from "~/lib/utils";

// GitHub-flavoured markdown, sanitised: scripts, iframes, event handlers and
// javascript:/data: URLs never reach the page. Task-list checkboxes survive.
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    input: [...(defaultSchema.attributes?.input ?? []), "type", "checked", "disabled"],
    li: [...(defaultSchema.attributes?.li ?? []), "className"],
  },
};

export default function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("md", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          ),
          li: ({ className: c, children, ...rest }) => (
            <li className={cn(c, c?.includes("task-list-item") && "task")} {...rest}>{children}</li>
          ),
          table: ({ node: _node, ...rest }) => (
            <div className="md-table">
              <table {...rest} />
            </div>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
