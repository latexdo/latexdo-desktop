import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function AiMessageMarkdown({
  text,
  onOpenExternal,
}: {
  text: string;
  onOpenExternal?: (url: string) => void;
}) {
  return (
    <div className="ai-message-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) =>
            href && /^https?:\/\//i.test(href) ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => {
                  if (onOpenExternal) {
                    event.preventDefault();
                    onOpenExternal(href);
                  }
                }}
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt }) => <span>{alt}</span>,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
