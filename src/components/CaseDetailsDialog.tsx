import { X } from "lucide-react";
import { useRef, useState } from "react";

import type { ReplayCase } from "../domain";
import { useDialogFocus } from "./useDialogFocus";

export interface CaseDetailsInput {
  title: string;
  incidentDate?: string;
  approximateTime?: string;
}

interface CaseDetailsDialogProps {
  replayCase: Pick<ReplayCase, "title" | "incidentDate" | "approximateTime">;
  onCancel: () => void;
  onSave: (input: CaseDetailsInput) => boolean;
}

export function CaseDetailsDialog({ replayCase, onCancel, onSave }: CaseDetailsDialogProps) {
  const [title, setTitle] = useState(replayCase.title);
  const [incidentDate, setIncidentDate] = useState(replayCase.incidentDate ?? "");
  const [approximateTime, setApproximateTime] = useState(replayCase.approximateTime ?? "");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useDialogFocus<HTMLElement>({
    initialFocusRef: titleInputRef,
    onEscape: onCancel,
  });
  const normalizedTitle = title.trim();
  const changed =
    normalizedTitle !== replayCase.title ||
    incidentDate !== (replayCase.incidentDate ?? "") ||
    approximateTime !== (replayCase.approximateTime ?? "");

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        ref={dialogRef}
        className="dialog case-details-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="case-details-title"
        aria-describedby="case-details-description"
        tabIndex={-1}
      >
        <header>
          <div>
            <p>Case record</p>
            <h2 id="case-details-title">Edit case details</h2>
          </div>
          <button className="icon-button" type="button" onClick={onCancel} aria-label="Close">
            <X size={17} aria-hidden="true" />
          </button>
        </header>
        <p id="case-details-description">
          These details appear in current report previews. Existing finalized snapshots do not
          change. The edit is attributed in case activity and can be undone.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!normalizedTitle || !changed) return;
            const input: CaseDetailsInput = { title: normalizedTitle };
            if (incidentDate) input.incidentDate = incidentDate;
            if (approximateTime) input.approximateTime = approximateTime;
            if (onSave(input)) onCancel();
          }}
        >
          <label className="field">
            <span>Case title</span>
            <input
              ref={titleInputRef}
              value={title}
              required
              maxLength={100}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <div className="field-row">
            <label className="field">
              <span>
                Incident date <small>optional</small>
              </span>
              <input
                type="date"
                value={incidentDate}
                onChange={(event) => setIncidentDate(event.target.value)}
              />
            </label>
            <label className="field">
              <span>
                Approximate time <small>optional</small>
              </span>
              <input
                type="time"
                value={approximateTime}
                onChange={(event) => setApproximateTime(event.target.value)}
              />
            </label>
          </div>
          <footer>
            <button className="button button--quiet" type="button" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="button button--primary"
              type="submit"
              disabled={!normalizedTitle || !changed}
            >
              Save details
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
