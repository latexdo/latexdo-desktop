import React from "react";
import { FilePlus2, FileText, History, Plus, Trash2 } from "lucide-react";
import type { RebuttalItem } from "../types";

interface RebuttalSidebarProps {
  items: RebuttalItem[];
  onAddItem: () => void;
  onAddRebuttalToSource: () => void;
  onUpdateItem: (id: string, updates: Partial<RebuttalItem>) => void;
  onDeleteItem: (id: string) => void;
  onGenerateLetter?: () => void;
  onInsertItemIntoTex?: (id: string) => void;
}

export const RebuttalSidebar: React.FC<RebuttalSidebarProps> = ({
  items,
  onAddItem,
  onAddRebuttalToSource,
  onUpdateItem,
  onDeleteItem,
  onGenerateLetter,
  onInsertItemIntoTex,
}) => {
  return (
    <div className="rebuttal-sidebar">
      <div className="sidebar-header-actions">
        <button className="sidebar-primary-action" onClick={onAddItem}>
          <Plus size={14} />
          <span>New Rebuttal Item</span>
        </button>
        <button
          className="sidebar-primary-action"
          onClick={onAddRebuttalToSource}
          title="Wrap the text selected in the editor in a rebuttal block"
        >
          <Plus size={14} />
          <span>Insert Selection in TeX</span>
        </button>
        {onGenerateLetter && (
          <button className="sidebar-primary-action" onClick={onGenerateLetter}>
            <FileText size={14} />
            <span>Export Response</span>
          </button>
        )}
      </div>

      <div className="sidebar-list">
        {items.length === 0 ? (
          <div className="sidebar-empty">
            <History size={32} />
            <p>No rebuttal items yet.</p>
            <p className="sub-text">
              Track reviewer responses as notes or TeX source changes.
            </p>
          </div>
        ) : (
          items.map((item, index) => (
            <div key={item.id} className="sidebar-item-card rebuttal-item-card">
              <div className="rebuttal-item-header">
                <div className="rebuttal-item-title">
                  <strong>Rebuttal Item {index + 1}</strong>
                  <span
                    title={
                      item.insertedInTex
                        ? "Edits here update the \\rebuttal block in the TeX source."
                        : "Kept in the sidebar and the exported response only."
                    }
                  >
                    {item.insertedInTex ? "In TeX source" : "Notes only"}
                  </span>
                </div>
                <div className="rebuttal-item-controls">
                  <button
                    className="small-icon delete-button"
                    onClick={() => onDeleteItem(item.id)}
                    title="Delete rebuttal item"
                    aria-label="Delete rebuttal item"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              <div className="rebuttal-field">
                <label htmlFor={`rebuttal-${item.id}-text`}>Text</label>
                <textarea
                  id={`rebuttal-${item.id}-text`}
                  value={item.originalText ?? ""}
                  onChange={(e) =>
                    onUpdateItem(item.id, { originalText: e.target.value })
                  }
                  placeholder="The manuscript text being discussed."
                />
              </div>

              <div className="rebuttal-field">
                <label htmlFor={`rebuttal-${item.id}-reviewer`}>Reviewer Comment</label>
                <textarea
                  id={`rebuttal-${item.id}-reviewer`}
                  value={item.reviewerComment}
                  onChange={(e) =>
                    onUpdateItem(item.id, { reviewerComment: e.target.value })
                  }
                  placeholder="What did the reviewer say?"
                />
              </div>

              <div className="rebuttal-field">
                <label htmlFor={`rebuttal-${item.id}-author`}>Author Answer</label>
                <textarea
                  id={`rebuttal-${item.id}-author`}
                  value={item.authorComment}
                  onChange={(e) =>
                    onUpdateItem(item.id, { authorComment: e.target.value })
                  }
                  placeholder="How do you respond?"
                />
              </div>

              <div className="rebuttal-field">
                <label htmlFor={`rebuttal-${item.id}-changes`}>Changes (diff)</label>
                <textarea
                  id={`rebuttal-${item.id}-changes`}
                  value={item.revisedText ?? item.modificationMade}
                  onChange={(e) =>
                    onUpdateItem(item.id, {
                      revisedText: e.target.value,
                      modificationMade: e.target.value,
                    })
                  }
                  placeholder="The revised manuscript text or a unified diff."
                />
              </div>

              {!item.insertedInTex && onInsertItemIntoTex ? (
                <div className="review-chat-footer">
                  <button
                    type="button"
                    className="sidebar-primary-action review-insert-button"
                    onClick={() => onInsertItemIntoTex(item.id)}
                    title="Wrap the text selected in the editor in this item's rebuttal block"
                  >
                    <FilePlus2 size={13} />
                    <span>Insert at selection</span>
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
