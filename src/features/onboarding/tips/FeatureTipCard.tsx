import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { FeatureTip } from "./featureTips";
import "./featureTips.css";

export interface FeatureTipCardProps {
  tip: FeatureTip;
  onAccept: () => void;
  onLater: () => void;
  onTurnOff: () => void;
}

/** A small, friendly "Did you know?" card in the corner of the window. */
export function FeatureTipCard({
  tip,
  onAccept,
  onLater,
  onTurnOff,
}: FeatureTipCardProps) {
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && cardRef.current?.contains(document.activeElement)) {
        onLater();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onLater]);

  return (
    <aside
      ref={cardRef}
      className="feature-tip"
      role="complementary"
      aria-labelledby="feature-tip-title"
    >
      <button
        type="button"
        className="feature-tip-close"
        onClick={onLater}
        aria-label="Close tip"
        title="Not now"
      >
        <X size={14} />
      </button>
      <div className="feature-tip-badge" aria-hidden="true">
        {tip.emoji}
      </div>
      <div className="feature-tip-text">
        <span className="feature-tip-eyebrow">Did you know?</span>
        <h3 id="feature-tip-title">{tip.title}</h3>
        <p>{tip.body}</p>
        <div className="feature-tip-actions">
          <button type="button" className="feature-tip-primary" onClick={onAccept}>
            {tip.action?.label ?? "Got it"}
          </button>
          {tip.action ? (
            <button type="button" className="feature-tip-secondary" onClick={onLater}>
              Not now
            </button>
          ) : null}
          <button type="button" className="feature-tip-off" onClick={onTurnOff}>
            Turn off tips
          </button>
        </div>
      </div>
    </aside>
  );
}
