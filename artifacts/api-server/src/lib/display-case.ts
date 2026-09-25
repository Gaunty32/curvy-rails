export function toDisplayCase(value: string | null | undefined): string | undefined {
  const normalised = value?.trim().replace(/\s+/g, " ");
  if (!normalised) return undefined;

  return normalised
    .toLocaleLowerCase("en-GB")
    .replace(/(^|[\s\-/'’(])([\p{L}\p{N}])/gu, (_match, prefix: string, character: string) =>
      `${prefix}${character.toLocaleUpperCase("en-GB")}`,
    );
}