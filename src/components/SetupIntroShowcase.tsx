import React from "react";
import { FileText, Play } from "lucide-react";

type SlideId = "write" | "ai" | "graph" | "sync" | "errors";

interface IntroSlide {
  id: SlideId;
  eyebrow: string;
  title: string;
  body: string;
}

// Same scenes, order of importance and wording as the latexdo.org homepage.
const slides: IntroSlide[] = [
  {
    id: "write",
    eyebrow: "Editor",
    title: "Everything your paper needs, in one window.",
    body: "Write LaTeX with completion, compile with one keystroke, and read the PDF beside your source.",
  },
  {
    id: "ai",
    eyebrow: "AI, on your terms",
    title: "An assistant that never leaves your laptop.",
    body: "Run a local model or bring your own provider. Nothing in your paper changes until you approve it.",
  },
  {
    id: "graph",
    eyebrow: "Knowledge graph",
    title: "See how your references connect.",
    body: "Search and insert citations without leaving the editor, then open the graph of your bibliography.",
  },
  {
    id: "sync",
    eyebrow: "Source and PDF",
    title: "Click a sentence. Land on its source.",
    body: "Jump from anywhere in the PDF to the line that produced it, or go the other way.",
  },
  {
    id: "errors",
    eyebrow: "Problems",
    title: "LaTeX errors, in plain language.",
    body: "No thousand-line logs: what went wrong, where, and how to fix it, with a jump to the line.",
  },
];

export const setupIntroSlideMs = 5600;

/** Advances the intro slides on its own while the intro step is on screen. */
export function useSetupIntroSlide(active: boolean): number {
  const [index, setIndex] = React.useState(0);

  React.useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(
      () => setIndex((current) => (current + 1) % slides.length),
      setupIntroSlideMs,
    );
    return () => window.clearTimeout(timer);
  }, [active, index]);

  return index;
}

type Token = ["k" | "t", string];

const writeLines: Token[][] = [
  [
    ["k", "\\documentclass"],
    ["t", "{article}"],
  ],
  [
    ["k", "\\title"],
    ["t", "{Efficient Retrieval}"],
  ],
  [
    ["k", "\\begin"],
    ["t", "{document}"],
  ],
  [["k", "\\maketitle"]],
  [
    ["k", "\\section"],
    ["t", "{Introduction}"],
  ],
  [
    ["t", "Recall improves "],
    ["k", "\\cite"],
    ["t", "{lewis2020}."],
  ],
  [
    ["k", "\\["],
    ["t", " s(q,d) = q \\cdot d "],
    ["k", "\\]"],
  ],
  [
    ["k", "\\end"],
    ["t", "{document}"],
  ],
];
/** The line the editor scene types before it compiles. */
const typedLineIndex = 5;

const WriteSlide: React.FC = () => (
  <div className="setup-demo">
    <div className="setup-demo-bar">
      <span className="setup-demo-dots">
        <i />
        <i />
        <i />
      </span>
      <span className="setup-demo-tab">
        <FileText size={11} /> main.tex
      </span>
      <span className="setup-demo-compile">
        <Play size={10} /> Compile
      </span>
    </div>
    <div className="setup-demo-split">
      <div className="setup-demo-source">
        {writeLines.map((tokens, index) => (
          <div
            key={index}
            className={`setup-demo-line ${index === typedLineIndex ? "typed" : ""}`}
          >
            <b>{index + 1}</b>
            <span className="setup-demo-code">
              {tokens.map(([kind, text], tokenIndex) => (
                <span key={tokenIndex} className={`tok-${kind}`}>
                  {text}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
      <div className="setup-demo-pdf">
        <div className="setup-demo-page">
          <strong>Efficient Retrieval</strong>
          <em>1&nbsp;&nbsp;Introduction</em>
          <p>Recall improves [1].</p>
          <p className="setup-demo-eq">s(q, d) = q · d</p>
        </div>
      </div>
    </div>
    <div className="setup-demo-status">
      <span>Compiled · 0 errors</span>
    </div>
  </div>
);

const AiSlide: React.FC = () => {
  // 0: sentence selected, 1: rewrite proposed, 2: rewrite approved.
  const [phase, setPhase] = React.useState(0);
  React.useEffect(() => {
    const timers = [
      window.setTimeout(() => setPhase(1), 1500),
      window.setTimeout(() => setPhase(2), 3600),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  return (
    <div
      className={`setup-ai ${phase >= 1 ? "is-proposed" : ""} ${
        phase >= 2 ? "is-approved" : ""
      }`}
    >
      <div className="setup-mini-bar">
        main.tex <span className="setup-pill">Approval required</span>
      </div>
      <p className="setup-ai-text">
        In this section we show that{" "}
        <span className="setup-ai-old">
          our approach is really much better than the others in a lot of cases.
        </span>{" "}
        <span className="setup-ai-new">
          our approach outperforms prior methods on four of five benchmarks.
        </span>
      </p>
      <div className="setup-ai-bar">
        <span className="setup-ai-prompt">
          <i />
          Make this precise
        </span>
        <span className="setup-ai-approve">Approve</span>
        <span className="setup-ai-reject">Reject</span>
      </div>
    </div>
  );
};

const GraphSlide: React.FC = () => (
  <div className="setup-graph-card">
    <svg className="setup-graph" viewBox="0 0 520 380" role="presentation">
      <g className="setup-graph-edges">
        <line x1="260" y1="190" x2="120" y2="90" />
        <line x1="260" y1="190" x2="400" y2="80" />
        <line x1="260" y1="190" x2="430" y2="230" />
        <line x1="260" y1="190" x2="300" y2="320" />
        <line x1="260" y1="190" x2="110" y2="260" />
        <line x1="120" y1="90" x2="60" y2="170" />
        <line x1="400" y1="80" x2="470" y2="130" />
        <line x1="430" y1="230" x2="470" y2="130" />
        <line x1="110" y1="260" x2="180" y2="330" />
        <line x1="300" y1="320" x2="180" y2="330" />
      </g>
      <g className="setup-graph-nodes">
        <circle cx="120" cy="90" r="13" />
        <circle cx="400" cy="80" r="16" />
        <circle cx="430" cy="230" r="12" />
        <circle cx="300" cy="320" r="14" />
        <circle cx="110" cy="260" r="11" />
        <circle cx="60" cy="170" r="8" />
        <circle cx="470" cy="130" r="9" />
        <circle cx="180" cy="330" r="8" />
      </g>
      <g className="setup-graph-root">
        <circle cx="260" cy="190" r="34" />
        <text x="260" y="195" textAnchor="middle">
          main.tex
        </text>
      </g>
      <g className="setup-graph-labels">
        <text x="120" y="66" textAnchor="middle">
          lewis2020
        </text>
        <text x="400" y="54" textAnchor="middle">
          vaswani2017
        </text>
        <text x="430" y="258" textAnchor="middle">
          karpukhin2020
        </text>
        <text x="300" y="350" textAnchor="middle">
          devlin2019
        </text>
        <text x="110" y="286" textAnchor="middle">
          robertson2009
        </text>
      </g>
    </svg>
  </div>
);

const SyncSlide: React.FC = () => (
  <div className="setup-sync">
    <div className="setup-sync-src">
      <div className="setup-mini-bar">main.tex</div>
      <code data-step="0">
        <b>8</b>
        <span className="k">\section</span>
        {"{Introduction}"}
      </code>
      <code data-step="1">
        <b>9</b>Our method improves recall by 12.4%
      </code>
      <code>
        <b>10</b>over the baseline <span className="k">\cite</span>
        {"{lewis2020}."}
      </code>
      <code data-step="2">
        <b>11</b>
        <span className="k">\includegraphics</span>
        {"{results.pdf}"}
      </code>
      <code>
        <b>12</b>
        <span className="k">\caption</span>
        {"{Recall on long inputs.}"}
      </code>
    </div>
    <div className="setup-sync-beam">
      <i />
    </div>
    <div className="setup-sync-pdf">
      <div className="setup-mini-bar">main.pdf</div>
      <div className="setup-sync-page">
        <b data-step="0">1&ensp;Introduction</b>
        <span data-step="1">
          Our method improves recall by 12.4% over the baseline [1].
        </span>
        <div className="setup-chart" data-step="2">
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
        <small>Figure 1: Recall on long inputs.</small>
      </div>
    </div>
  </div>
);

const ErrorsSlide: React.FC = () => (
  <div className="setup-errors">
    <pre className="setup-log">
      {"! LaTeX Error: File `figures/results.pdf' not found.\n"}
      {"See the LaTeX manual or LaTeX Companion for explanation.\n"}
      {"l.42 \\includegraphics{figures/results.pdf}\n"}
      <mark>! Emergency stop.</mark>
    </pre>
    <div className="setup-errors-arrow">
      <i />
    </div>
    <div className="setup-problem">
      <div className="setup-problem-head">
        <span className="setup-badge">Error</span>
        <span className="setup-chip">main.tex:42</span>
      </div>
      <strong>Figure file not found</strong>
      <p>
        LaTeX could not find <code>figures/results.pdf</code>. Check the file name and
        folder.
      </p>
      <span className="setup-problem-action">Go to line 42 →</span>
    </div>
  </div>
);

const slideVisuals: Record<SlideId, React.FC> = {
  write: WriteSlide,
  ai: AiSlide,
  graph: GraphSlide,
  sync: SyncSlide,
  errors: ErrorsSlide,
};

/** The animated scene of the current slide. Decorative: the caption carries the text. */
export const SetupIntroStage: React.FC<{ index: number }> = ({ index }) => {
  const slide = slides[index];
  const Visual = slideVisuals[slide.id];
  return (
    <div className="setup-intro-visual" data-slide={slide.id} aria-hidden="true">
      {/* Re-keyed per slide so every scene replays from its first frame. */}
      <div className="setup-slide" key={slide.id}>
        <Visual />
      </div>
    </div>
  );
};

export const SetupIntroCaption: React.FC<{ index: number }> = ({ index }) => {
  const slide = slides[index];
  return (
    <div className="setup-intro-caption">
      <div className="setup-intro-caption-text" key={slide.id}>
        <span className="setup-intro-eyebrow">{slide.eyebrow}</span>
        <p className="setup-intro-title">{slide.title}</p>
        <p className="setup-intro-body">{slide.body}</p>
      </div>
      <div className="setup-intro-dots" aria-hidden="true">
        {slides.map((item, itemIndex) => (
          <i key={item.id} className={itemIndex === index ? "on" : ""} />
        ))}
      </div>
    </div>
  );
};
