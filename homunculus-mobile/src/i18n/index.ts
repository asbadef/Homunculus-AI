import { tr } from "./tr";

export type MessageKey = keyof typeof tr;

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const template: string = tr[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
