import editorial from "./library/editorial";
import corporate from "./library/corporate";
import modern from "./library/modern";
import type { TemplateComponent } from "./types";
// Bespoke templates will be added here as they are built
// e.g. import nedbankCustom1 from './bespoke/nedbank_custom_1';

export const templateRegistry: Record<string, TemplateComponent> = {
  editorial,
  corporate,
  modern,
  // e.g. 'nedbank_custom_1': nedbankCustom1,
};

export function getTemplate(key: string): TemplateComponent | null {
  return templateRegistry[key] ?? null;
}

export function templateExists(key: string): boolean {
  return key in templateRegistry;
}

export function listTemplateKeys(): string[] {
  return Object.keys(templateRegistry);
}
