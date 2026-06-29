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

describe("buildChatSystemPrompt question handling", () => {
  it("keeps the AI as the point of contact and never defers questions to a human", () => {
    const prompt = buildChatSystemPrompt({ ...base, source: null });
    // Answers must be grounded in the role info, not punted to "the team".
    expect(prompt).toContain("Role Information and job description");
    expect(prompt).toContain("point of contact for questions");
    expect(prompt).not.toContain("recruiting team will be able to help you");
  });
});

describe("buildChatSystemPrompt bounded digging", () => {
  const withTopic = {
    ...base,
    source: null,
    topics: [{ flag: "tenure", topic: "Confirm the reason for short tenure", covered: false }],
  };

  it("invites a follow-up for thin answers but caps the digging", () => {
    const prompt = buildChatSystemPrompt(withTopic);
    expect(prompt).toContain("follow-up");
    expect(prompt).toMatch(/move on/i);
    // The old "accept the first answer, do not probe" stance is gone.
    expect(prompt).not.toContain("Accept the candidate's first answer");
    expect(prompt).not.toContain("do NOT probe");
  });
});
