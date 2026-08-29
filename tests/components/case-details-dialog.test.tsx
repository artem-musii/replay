import { fireEvent, render, screen } from "@testing-library/react";

import { CaseDetailsDialog } from "../../src/components/CaseDetailsDialog";

describe("CaseDetailsDialog", () => {
  it("focuses the title, detects changes, and returns normalized optional details", () => {
    const onCancel = vi.fn();
    const onSave = vi.fn().mockReturnValue(true);
    render(
      <CaseDetailsDialog
        replayCase={{
          title: "Original title",
          incidentDate: "2026-08-29",
          approximateTime: "17:42",
        }}
        onCancel={onCancel}
        onSave={onSave}
      />,
    );

    const title = screen.getByRole("textbox", { name: "Case title" });
    expect(title).toHaveFocus();
    expect(screen.getByRole("button", { name: "Save details" })).toBeDisabled();

    fireEvent.change(title, { target: { value: "  Corrected title  " } });
    fireEvent.change(screen.getByLabelText(/Incident date/), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/Approximate time/), {
      target: { value: "18:05" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));

    expect(onSave).toHaveBeenCalledWith({
      title: "Corrected title",
      approximateTime: "18:05",
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("stays open after a rejected command and closes with Escape", () => {
    const onCancel = vi.fn();
    const onSave = vi.fn().mockReturnValue(false);
    render(
      <CaseDetailsDialog
        replayCase={{ title: "Original title" }}
        onCancel={onCancel}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Case title" }), {
      target: { value: "Corrected title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Edit case details" }), {
      key: "Escape",
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
