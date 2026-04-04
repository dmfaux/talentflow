export interface GatingQuestion {
  id: string;
  label: string;
  type: string;
  options: { value: string }[];
  pass_criteria: string[];
}

export function evaluateGating(
  answers: Record<string, string>,
  gatingConfig: GatingQuestion[]
): boolean {
  return gatingConfig.every((question) => {
    const answer = answers[question.id];
    if (answer === undefined) return false;
    return question.pass_criteria.includes(answer);
  });
}
