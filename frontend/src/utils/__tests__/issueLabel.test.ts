import { describe, it, expect } from "vitest";
import { issueLabel } from "../issueLabel";

describe("issueLabel", () => {
  it("takes the key from a tracker link", () => {
    expect(issueLabel("https://tracker.yandex.ru/FLEX-1")).toBe("FLEX-1");
    expect(issueLabel("https://tracker.yandex.ru/FLEX-1/")).toBe("FLEX-1");
  });

  it("names the project for a GitLab issue", () => {
    expect(issueLabel("https://gitlab.company.ru/team/web/-/issues/42")).toBe("web#42");
    expect(issueLabel("https://gitlab.com/a/b/c/-/work_items/7")).toBe("c#7");
  });

  it("ignores anchors and queries", () => {
    expect(issueLabel("https://gitlab.company.ru/team/web/-/issues/42#note_9")).toBe("web#42");
    expect(issueLabel("https://tracker.yandex.ru/FLEX-1?x=1")).toBe("FLEX-1");
  });

  it("understands a bare mention", () => {
    expect(issueLabel("team/web#42")).toBe("web#42");
  });

  it("leaves anything else alone", () => {
    expect(issueLabel("FLEX-1")).toBe("FLEX-1");
    expect(issueLabel("")).toBe("");
  });
});
