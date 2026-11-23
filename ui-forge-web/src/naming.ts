/** Same naming rules as src/ui_forge/naming.py, for suggestions in the builder. */
const WORD = /[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+/g;

export const words = (s: string): string[] => (s.replace(/[-_.]/g, ' ').match(WORD) || []).map((w) => w.toLowerCase());
export const kebab = (s: string) => words(s).join('-');
export const pascal = (s: string) => words(s).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
export const camel = (s: string) => { const p = pascal(s); return p ? p[0].toLowerCase() + p.slice(1) : ''; };
/** Looks plural already: ends in s, but not ss / us / is (Address, Status, Analysis are singular). */
export const looksPlural = (word: string) => /[^sui]s$/i.test(word) || /ies$/i.test(word);
export function plural(word: string): string {
  if (!word || looksPlural(word)) return word;
  if (/sis$/i.test(word)) return word.slice(0, -2) + 'es';
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/i.test(word)) return word + 'es';
  return word + 's';
}
/** "Items" -> "Item", "Entities" -> "Entity", "Addresses" -> "Address"; singular words are kept. */
export function singular(word: string): string {
  if (!word || !looksPlural(word)) return word;
  if (/[^aeiou]ies$/i.test(word)) return word.slice(0, -3) + 'y';
  if (/(ss|x|z|ch|sh)es$/i.test(word)) return word.slice(0, -2);
  return word.slice(0, -1);
}
/** "Maintenance Crews" -> "Maintenance Crew" (the last word) */
export function singularLabel(label: string): string {
  const parts = label.trim().split(/\s+/);
  parts[parts.length - 1] = singular(parts[parts.length - 1] || '');
  return parts.join(' ');
}
/** "Generation Asset" -> "Generation Assets" (pluralises the last word) */
export function pluralLabel(label: string): string {
  const parts = label.trim().split(/\s+/);
  parts[parts.length - 1] = plural(parts[parts.length - 1] || '');
  return parts.join(' ');
}
export function uniqueName(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 2; ; i++) if (!set.has(base + i)) return base + i;
}
