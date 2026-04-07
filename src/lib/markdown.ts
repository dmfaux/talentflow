import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(input: string | null | undefined): string {
  if (!input?.trim()) return "";
  return marked.parse(input, { async: false }) as string;
}
