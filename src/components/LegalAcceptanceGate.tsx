import React from "react";
import { Check, ExternalLink, Lock } from "lucide-react";
import { legalPrivacyUrl, legalTermsUrl } from "../features/settings/settings";

interface LegalAcceptanceGateProps {
  onAccept: () => void;
  onOpenExternal: (url: string) => void;
  productName?: string;
}

export const LegalAcceptanceGate: React.FC<LegalAcceptanceGateProps> = ({
  onAccept,
  onOpenExternal,
  productName = "LatexDo",
}) => {
  const [termsAccepted, setTermsAccepted] = React.useState(false);
  const [privacyAccepted, setPrivacyAccepted] = React.useState(false);
  const canContinue = termsAccepted && privacyAccepted;

  const openPolicy = (event: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    event.preventDefault();
    onOpenExternal(url);
  };

  return (
    <div className="legal-acceptance-overlay">
      <section
        className="legal-acceptance-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="legal-acceptance-title"
      >
        <div className="legal-acceptance-header">
          <div className="dialog-icon">
            <Lock size={20} />
          </div>
          <div className="dialog-copy">
            <h2 id="legal-acceptance-title">Terms and Privacy</h2>
            <p>Accept both policies before using {productName}.</p>
          </div>
        </div>

        <form
          className="legal-acceptance-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (canContinue) {
              onAccept();
            }
          }}
        >
          <label className="legal-acceptance-check">
            <input
              type="checkbox"
              aria-label="Accept Terms of Use"
              checked={termsAccepted}
              onChange={(event) => setTermsAccepted(event.target.checked)}
            />
            <span>
              I accept the{" "}
              <a
                href={legalTermsUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => openPolicy(event, legalTermsUrl)}
              >
                Terms of Use <ExternalLink size={12} />
              </a>
              .
            </span>
          </label>

          <label className="legal-acceptance-check">
            <input
              type="checkbox"
              aria-label="Accept Privacy Policy"
              checked={privacyAccepted}
              onChange={(event) => setPrivacyAccepted(event.target.checked)}
            />
            <span>
              I accept the{" "}
              <a
                href={legalPrivacyUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => openPolicy(event, legalPrivacyUrl)}
              >
                Privacy Policy <ExternalLink size={12} />
              </a>
              .
            </span>
          </label>

          <button
            type="submit"
            className="dialog-submit legal-acceptance-submit"
            disabled={!canContinue}
          >
            Continue <Check size={14} />
          </button>
        </form>
      </section>
    </div>
  );
};
