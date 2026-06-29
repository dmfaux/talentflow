import { describe, expect, it } from "vitest";
import { buildChatSystemPrompt } from "./chat-prompt";

const base = {
  candidateName: "Alex",
  roleTitle: "Engineer",
  roleDescription: null,
  companyName: "Acme",
  location: null,
  employmentType: null,
  salaryRangeMin: null,
  salaryRangeMax: null,
  cvText: null,
  gatingAnswers: null,
  topics: [],
  lifecycle: "dormant",
};

describe("buildChatSystemPrompt source awareness", () => {
  it("frames a self-applied candidate as having applied", () => {
    const prompt = buildChatSystemPrompt({ ...base, source: null });
    expect(prompt).toContain("applied for the Engineer position");
    expect(prompt).not.toContain("by a recruiter");
  });

  it("frames a recruiter-added candidate as sourced, not as an applicant", () => {
    const prompt = buildChatSystemPrompt({
      ...base,
      source: "recruiter_manual",
    });
    expect(prompt).toContain("added to the Engineer role by a recruiter");
    expect(prompt).toContain("never thank them for applying");
    expect(prompt).not.toContain("who applied for the Engineer position");
  });
});
