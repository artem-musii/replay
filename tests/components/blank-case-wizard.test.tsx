import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { BlankCaseWizard } from "../../src/components/BlankCaseWizard";

describe("BlankCaseWizard", () => {
  it("keeps whitespace-only titles inline and focuses the invalid field", () => {
    const onCreate = vi.fn();
    render(<BlankCaseWizard onCancel={vi.fn()} onCreate={onCreate} />);

    const title = screen.getByRole("textbox", { name: "Case title" });
    fireEvent.change(title, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a case title before continuing.");
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(title).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Name the case." })).toBeVisible();
    expect(onCreate).not.toHaveBeenCalled();

    fireEvent.change(title, { target: { value: "  Normalized local case  " } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("focuses and announces navigated steps while normalizing the submitted text", async () => {
    const onCreate = vi.fn();
    render(<BlankCaseWizard onCancel={vi.fn()} onCreate={onCreate} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Case title" }), {
      target: { value: "  Normalized local case  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const sceneHeading = screen.getByRole("heading", { name: "Choose the scene." });
    await waitFor(() => expect(sceneHeading).toHaveFocus());
    expect(screen.getByRole("status")).toHaveTextContent("Step 2 of 3");

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const statementHeading = screen.getByRole("heading", {
      name: "Record a first statement, if known.",
    });
    await waitFor(() => expect(statementHeading).toHaveFocus());
    expect(screen.getByRole("status")).toHaveTextContent("Step 3 of 3");

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Choose the scene." })).toHaveFocus(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    fireEvent.change(screen.getByRole("textbox", { name: /Initial factual statement/ }), {
      target: { value: "  Vehicle A was present.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create local case" }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Normalized local case",
        initialStatement: "Vehicle A was present.",
      }),
    );
  });

  it("omits an optional statement that contains only whitespace", () => {
    const onCreate = vi.fn();
    render(<BlankCaseWizard onCancel={vi.fn()} onCreate={onCreate} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Initial factual statement/ }), {
      target: { value: " \n\t " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create local case" }));

    const submitted = onCreate.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(submitted).toMatchObject({ title: "Untitled incident" });
    expect(submitted).not.toHaveProperty("initialStatement");
  });
});
