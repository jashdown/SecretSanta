// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EmailStatusBadge, LocalTime, Notice } from "./ui";

describe("LocalTime", () => {
  const iso = "2025-12-24T18:30:00.000Z";
  const local = (options: Intl.DateTimeFormatOptions) =>
    new Date(iso).toLocaleString(undefined, options);

  it("renders UTC on the server, which can't know the viewer's time zone", () => {
    vi.stubEnv("TZ", "Asia/Tokyo");
    const html = renderToString(<LocalTime iso={iso} />);
    expect(html).toMatch(/datetime="2025-12-24T18:30:00.000Z"/i);
    expect(html).toMatch(/Dec 24, 2025, 6:30\sPM/);
  });

  it("can leave the time out", () => {
    const html = renderToString(<LocalTime iso={iso} dateOnly />);
    expect(html).toContain(">Dec 24, 2025<");
  });

  it("shows the viewer's own time zone in the browser", () => {
    vi.stubEnv("TZ", "Asia/Tokyo");
    const { container } = render(<LocalTime iso={iso} />);
    const time = container.querySelector("time")!;

    expect(time).toHaveAttribute("datetime", iso);
    expect(time).toHaveTextContent(local({ dateStyle: "medium", timeStyle: "short" }));
    // In Tokyo it's already Christmas morning.
    expect(time).not.toHaveTextContent(/Dec 24, 2025, 6:30\sPM/);
  });
});

describe("EmailStatusBadge", () => {
  it.each([
    ["pending", "Not sent"],
    ["sent", "Sent"],
    ["logged", "Preview only"],
    ["failed", "Failed"],
  ] as const)("labels %s as %j", (status, label) => {
    render(<EmailStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe("Notice", () => {
  it("interrupts screen readers for errors", () => {
    render(<Notice tone="error">Something broke</Notice>);
    expect(screen.getByRole("alert")).toHaveTextContent("Something broke");
  });

  it.each(["info", "success", "warning"] as const)("announces %s politely", (tone) => {
    render(<Notice tone={tone}>Heads up</Notice>);
    expect(screen.getByRole("status")).toHaveTextContent("Heads up");
  });
});
