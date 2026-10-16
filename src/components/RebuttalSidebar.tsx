import React from "react";
import { FilePlus2, FileText, History, MessageSquarePlus, Trash2 } from "lucide-react";
import type { RebuttalItem } from "../types";
import {
  defaultReviewerName,
  groupByReviewer,
  rebuttalLetterFileName,
} from "../rebuttalGenerator";

interface RebuttalSidebarProps {
  items: RebuttalItem[];
  onAddItem: () => void;
  onAddRebuttalToSource: () => void;
  onUpdateItem: (id: string, updates: Partial<RebuttalItem>) => void;
  onDeleteItem: (id: string) => void;
  onGenerateLetter?: () => void;
  /** The letter file, relative to the project folder. */
  letterPath?: string;
  letterExists?: boolean;
  onOpenLetter?: () => void;
  onInsertItemIntoTex?: (id: string) => void;
}

export const RebuttalSidebar: React.FC<RebuttalSidebarProps> = ({
  items,
  onAddItem,
  onAddRebuttalToSource,
  onUpdateItem,
  onDeleteItem,
  onGenerateLetter,
  letterPath = rebuttalLetterFileName,
  letterExists = false,
  onOpenLetter,
  onInsertItemIntoTex,
}) => {
  const reviewers = groupByReviewer(items);
  // "Reviewer 2 · Comment 2.3", numbered like the letter.
  const positions = new Map<string, string>();
  reviewers.forEach(([reviewer, comments], reviewerIndex) =>
    comments.forEach((item, commentIndex) =>
      positions.set(
        item.id,
        `${reviewer} · Comment ${reviewerIndex + 1}.${commentIndex + 1}`,
      ),
    ),
  );
  const reviewerNames = [
    ...new Set([
      ...reviewers.map(([name]) => name),
      "Reviewer 1",
      "Reviewer 2",
      "Reviewer 3",
      "Editor",
    ]),
  ];

  return (
    <div className="rebuttal-sidebar">
      {onGenerateLetter ? (
        <section className="rebuttal-letter-card" aria-label="Response letter">
          <div className="rebuttal-letter-head">
            <FileText size={15} aria-hidden="true" />
            <strong>Response letter</strong>
          </div>
          <p>
            {letterExists ? "Saved as " : "Will be saved as "}
            <code>{letterPath}</code> in your project folder. It is a normal LaTeX file:
            edit it however you like.
          </p>
          <div className="rebuttal-letter-actions">
            <button
              type="button"
              className="sidebar-primary-action"
              onClick={onGenerateLetter}
              disabled={items.length === 0}
              title={
                items.length === 0
                  ? "Add the reviewers' comments first"
                  : "Write the letter from the comments below and open it"
              }
            >
              <FileText size={14} />
              <span>{letterExists ? "Update letter" : "Create letter"}</span>
            </button>
            {letterExists && onOpenLetter ? (
              <button type="button" className="dialog-cancel" onClick={onOpenLetter}>
                Open
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="sidebar-header-actions">
        <button className="sidebar-primary-action" onClick={onAddItem}>
          <MessageSquarePlus size={14} />
          <span>Add comment</span>
        </button>
        <button
          className="sidebar-primary-action"
          onClick={onAddRebuttalToSource}
          title="Add a comment about the text selected in the editor, and mark that text in the TeX source"
        >
          <FilePlus2 size={14} />
          <span>Add comment on selection</span>
        </button>
      </div>

      <datalist id="rebuttal-reviewer-names">
        {reviewerNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <div className="sidebar-list">
        {items.length === 0 ? (
          <div className="sidebar-empty">
            <History size={32} />
            <p>No reviewer comments yet.</p>
            <p className="sub-text">
              Add each reviewer comment with your response. LatexDo turns them into the
              response letter.
            </p>
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="sidebar-item-card rebuttal-item-card">
              <div className="rebuttal-item-header">
                <div className="rebuttal-item-title">
                  <strong>{positions.get(item.id)}</strong>
                  <span
                    title={
                      item.insertedInTex
                        ? "Edits here update the \\rebuttal block in the TeX source."
                        : "Kept in this panel and in the letter only."
                    }
                  >
                    {item.insertedInTex ? "Marked in TeX" : "Notes only"}
                  </span>
                </div>
                <div className="rebuttal-item-controls">
                  <button
                    className="small-icon delete-button"
                    onClick={() => onDeleteItem(item.id)}
                    title="Delete this comment"
                    aria-label="Delete rebuttal item"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              <div className="rebuttal-field">
                <label htmlFor={`rebuttal-${item.id}-who`}>Reviewer</label>
                <input
                  id={`rebuttal-${item.id}-who`}
                  list="rebuttal-reviewer-names"
                  value={item.reviewer ?? defaultReviewerName}
                  onChange={(e) => onUpdateItem(item.id, { reviewer: e.target.value })}
                  placeholder={defaultReviewerName}
                />
              </div>

              <div className="rebuttal-field">
                <label htmlFor={`rebuttal-${item.id}-reviewer`}>
                  Reviewer's comment
                </label>
                <textarea
                  id={`rebuttal-${item.id}-reviewer`}
                  value={item.reviewerComment}
                  onChange={(e) =>
                    onUpdateItem(item.id, { reviewerComment: e.target.value })
                  }
                  placeholder="Paste what the reviewer wrote."
                />
              </div>

              <div className="rebuttal-field">
                <label htmlFor={`rebuttal-${item.id}-author`}>Your response</label>
                <textarea
                  id={`rebuttal-${item.id}-author`}
                  value={item.authorComment}
                  onChange={(e) =>
                    onUpdateItem(item.id, { authorComment: e.target.value })
                  }
                  placeholder="How you answer, or what you changed."
                />
              </div>

              <div className="rebuttal-field">
                <label htmlFor={`rebuttal-${item.id}-text`}>
                  Original text <small>optional</small>
                </label>
                <textarea
                  id={`rebuttal-${item.id}-text`}
                  value={item.originalText ?? ""}
                  onChange={(e) =>
                    onUpdateItem(item.id, { originalText: e.target.value })
                  }
                  placeholder="The manuscript text before your change."
                />
              </div>

              <div className="rebuttal-field">
                <label htmlFor={`rebuttal-${item.id}-changes`}>
                  Revised text <small>optional</small>
                </label>
                <textarea
                  id={`rebuttal-${item.id}-changes`}
                  value={item.revisedText ?? item.modificationMade}
                  onChange={(e) =>
                    onUpdateItem(item.id, {
                      revisedText: e.target.value,
                      modificationMade: e.target.value,
                    })
                  }
                  placeholder="The same text after your change."
                />
              </div>

              {!item.insertedInTex && onInsertItemIntoTex ? (
                <div className="review-chat-footer">
                  <button
                    type="button"
                    className="sidebar-primary-action review-insert-button"
                    onClick={() => onInsertItemIntoTex(item.id)}
                    title="Mark the text selected in the editor with this comment"
                  >
                    <FilePlus2 size={13} />
                    <span>Mark selected text in TeX</span>
                  </button>
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
