# Implementation Plan: Other languages and regions

**Spec**: [spec.md](spec.md)

## Summary

`src/lib/textgen/locales.ts` holds the plain list of regions (safe for the page). `wordlists.ts` (generating worker only) builds a word
set per region from the library's data (`localeWords`): first and last names, whole street names in the region's pattern, where the house
number goes and the region's phone shape. `localePersonal.ts` makes the name, email, phone and address composers for a region;
`makePersonalComposer(kind, format, locale)` uses them and leaves URLs, IP addresses and SSN-style numbers alone. The region travels as
`locale` on a personal column in the profile (a local edit), the spec, the sample request, the Design form and the README.

## Constitution Check

Principle II names the locale; it is amended (version 1.0.2) from "en_US for v1" to "en_US by default, with the regions of this slice
selectable". Privacy is unchanged (word lists only, none from real data). Reproducibility: deterministic composers. Bundle: the
generating worker grows (research notes the figure); the page does not load the lists.
