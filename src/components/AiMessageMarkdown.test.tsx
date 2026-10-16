import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AiMessageMarkdown } from "./AiMessageMarkdown";

it("renders assistant emphasis, lists and literal code (#255)", () => {
  const { container } = render(
    <AiMessageMarkdown
      text={"1. **Problem**: details\n2. *Solution*\n\n```latex\n\\section{Intro}\n```"}
    />,
  );
  expect(screen.getByText("Problem").tagName).toBe("STRONG");
  expect(screen.getByText("Solution").tagName).toBe("EM");
  expect(container.querySelectorAll("ol li")).toHaveLength(2);
  expect(container.querySelector("pre code")).toHaveTextContent("\\section{Intro}");
});

it("opens safe links explicitly and never loads model-supplied HTML or images", () => {
  const open = vi.fn();
  const { container } = render(
    <AiMessageMarkdown
      onOpenExternal={open}
      text={
        "[Paper](https://example.org/paper)\n\n[Bad](javascript:alert%281%29)\n\n<img src=x onerror=alert(1)>\n\n![tracking](https://example.org/pixel)"
      }
    />,
  );
  fireEvent.click(screen.getByRole("link", { name: "Paper" }));
  expect(open).toHaveBeenCalledWith("https://example.org/paper");
  expect(screen.queryByRole("link", { name: "Bad" })).toBeNull();
  expect(container.querySelector("img")).toBeNull();
});
