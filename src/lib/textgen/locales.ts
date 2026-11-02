// The regions the invented names, emails, phone numbers and addresses can come from (specs/014). The list and its labels are
// plain data with no word lists, so the page and the profile worker may import it; the words themselves live in wordlists.ts,
// which only the generating worker loads.

export type PersonalLocale = "en_US" | "es" | "es_MX" | "fr" | "de" | "pt_BR";

export const DEFAULT_LOCALE: PersonalLocale = "en_US";

export const LOCALES: readonly { value: PersonalLocale; label: string }[] = [
  { value: "en_US", label: "English, United States" },
  { value: "es", label: "Spanish, Spain" },
  { value: "es_MX", label: "Spanish, Mexico" },
  { value: "fr", label: "French, France" },
  { value: "de", label: "German, Germany" },
  { value: "pt_BR", label: "Portuguese, Brazil" },
];

export const localeLabel = (locale: PersonalLocale): string =>
  LOCALES.find((l) => l.value === locale)?.label ?? locale;
