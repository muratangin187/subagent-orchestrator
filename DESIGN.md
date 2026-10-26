# Agent Workspace design

## Context and direction
A technical conversational workspace, used daily to delegate and inspect real work across computers. The main action is sending an instruction, then understanding its progress. Desktop supports dense inspection; Android supports short conversations and quick decisions.

Adjectives: precise (aligned text and tabular timing), calm (neutral surfaces), legible (Plex Sans and stronger contrast), practical (compact controls and progressive disclosure).
Essence: quiet, technical, direct. Reference: T3 Code's expandable work log and left-aligned conversational flow. Avoid marketing-style heroes, tinted surfaces everywhere, floating decoration, nested cards and indistinguishable controls.

Signature: the work transcript. Elapsed time, commands, results and assistant text follow one left reading edge; secondary information unfolds in place.

## Typography
Bundled IBM Plex Sans variable, Google Fonts / IBM, SIL OFL; no remote font requests. One family for headings and prose deliberately avoids display typography in a frequent-use tool. System monospace is reserved for commands and output. Base 15px desktop / 16sp Android, approximate 1.25 scale: 12, 15, 19, 24, 30, 38. Compact metadata may use 12px; body uses 1.6 line height. Weights 400/500/600. Left-aligned prose up to 75ch, user messages aligned right.

## Semantic colors
CSS custom properties use OKLCH; Compose uses the corresponding sRGB values. Theme: system (default), light, dark. Accent: teal (default), blue, copper, rose. Stored locally per device, applied immediately. OS changes affect only system mode. Semantic success/warning/error remain independent of accent.

| Role | Light OKLCH | Dark OKLCH |
| --- | --- | --- |
| Background | 0.97 0.002 250 | 0.18 0.004 250 |
| Surface | 0.995 0.001 250 | 0.21 0.004 250 |
| Raised / hover | 0.94 0.003 250 | 0.26 0.005 250 |
| Foreground | 0.25 0.008 250 | 0.93 0.003 250 |
| Muted text | 0.48 0.009 250 | 0.72 0.008 250 |
| Divider | 0.86 0.005 250 | 0.36 0.007 250 |
| Control edge | 0.60 0.008 250 | 0.58 0.008 250 |
| Teal | 0.46 0.08 180 | 0.78 0.09 180 |
| Blue | 0.48 0.13 250 | 0.78 0.10 250 |
| Copper | 0.49 0.12 45 | 0.80 0.10 45 |
| Rose | 0.49 0.13 10 | 0.79 0.10 10 |
| Success | 0.45 0.09 155 | 0.78 0.10 155 |
| Warning | 0.48 0.09 75 | 0.82 0.10 75 |
| Error | 0.48 0.16 25 | 0.79 0.10 25 |

Neutral surfaces dominate. Accent appears in primary actions, selection and focus, not every container. Code and file previews use neutral surfaces; documents retain their original rendering.

## Spacing and surfaces
4px base; 4/8/12/16 within groups, 24/32 between sections. Two corner radii: 6px for controls, 12px for dialogs/composer/messages. Circles only for status indicators and color swatches. Defined edges, no diffuse shadows or decorative blur. Task lists use separators and selected/hover fills, not floating cards. Preserve existing navigation and left alignment at wide sizes.

## Components and states
Primary filled accent, secondary outlined, tertiary text. Hover uses neutral raised surface; pressed uses subtle opacity, no scale animation. Disabled retains native disabled semantics. Visible 2px focus ring; controls at least 28px desktop, 48dp mobile. Text labels accompany selected theme/color and tool statuses. Settings grouped by purpose, immediate appearance changes with a local-save note. Modal keyboard focus is trapped and returned on close.

## Motion and imagery
No entrance animations or theme-switch animations. Only ongoing-work indicators animate with reduced-motion support. Lucide on desktop (18–20px, consistent 1.75 stroke) and native Material icons on Android. No new decorative imagery; existing voice avatar remains functional and its surrounding controls follow the theme.

## Dark mode and accessibility
Dark surfaces use a designed lightness ramp, off-white text and lighter accent siblings. Native controls use the selected color scheme. Contrast tested for foreground, muted, accent and semantic colors against adjacent surfaces. Theme selection is keyboard operable and does not reset drafts, navigation or chats. Appearance settings survive restart. Font includes Turkish glyphs. Full screen-reader certification is not claimed.

## Audit
2026-10-26: Removed pervasive green surfaces, diffuse shadows, decorative gradients, large radii, marketing copy and floating task cards. Replaced the three-column board with a grouped work queue. Self-audit: 8/10, intentionally one font family for utility UI rather than a decorative display pair.

Verified: desktop 8 light/dark × accent combinations, saved preferences after reload and application replacement, keyboard focus wrap in Settings; physical Fold7 light/copper and dark/blue, persisted selection after process restart, native light/dark status icons, neutral transcript and session list. Core foreground/muted/accent/error contrast against all three base surfaces: light minimum 5.47:1, dark minimum 6.28:1. 55 server tests + 11 desktop tests pass; desktop package builds and Android release/lint pass.

Limitations: full screen-reader/200% zoom audit not performed. Android Settings retains FLAG_SECURE because it contains credentials: its controls were checked through accessibility, and resulting themes were inspected in chat. Existing attachment viewers retain document colors deliberately. Final Mac startup requires the existing Keychain authorization after ad-hoc signing; appearance loads independently while connection authorization is pending.

## Changelog
2026-10-26: Established neutral transcript-first design; local appearance preferences for desktop and Android. Applied samber's frontend-design-deslop principles with an intentional single-family type system appropriate to a technical application.

## sRGB equivalents for native clients

| Role | Light | Dark |
| --- | --- | --- |
| bg | #f4f5f6 | #101213 |
| surface | #fdfdfe | #17181a |
| raised | #eaebed | #222426 |
| fg | #1f2225 | #e6e8ea |
| muted | #5a5e63 | #a1a5a9 |
| line | #ced1d4 | #3a3d41 |
| control | #7d8185 | #777b7f |
| error | #a5292b | #f4a19a |
| teal | #0c665a | #71cbb9 |
| blue | #0c60a3 | #85bcf5 |
| copper | #96461d | #f4a988 |
| rose | #9b3a4f | #f3a0ac |
