# Conversation workspace redesign — 27 October 2026

User direction: calm and simple, Linear / native Mac feel. Desktop and Android
remain one product with platform-appropriate layouts. Existing theme/accent,
session selection, queue/steer semantics, ownership and signing remain intact.

## Reference experiments

All 14 repositories in the user's screenshot were checked on GitHub. Popularity
numbers in the screenshot were not used as quality evidence. Four repositories
were cloned read-only into a temporary research directory; no global skills,
hooks, external UI runtime, or animation dependencies were installed.

| Repository | Fit and use |
| --- | --- |
| [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | Ran its Python design-system search for the actual workspace brief. Flat surfaces and restrained motion fit; its product-demo/marketing layout did not, and was rejected. |
| [awesome-design-md](https://github.com/VoltAgent/awesome-design-md) | Read the Linear analysis as a reference. Its marketing display sizes were not copied into the app. |
| [open-design](https://github.com/nexu-io/open-design) | A separate design workspace; not an in-app component dependency. |
| [taste-skill](https://github.com/Leonxlnx/taste-skill) | Ran its app-screen draw tool with workspace/inbox/detail/settings, preserving palette and type. Applied the framed reading surface and progressive-detail approach. |
| [impeccable](https://github.com/pbakaus/impeccable) | Read app-mode and craft-floor guidance; applied hierarchy, readable measure, focus/state and contrast checks. Engine/hook not installed. |
| [react-bits](https://github.com/DavidHDev/react-bits) | Animation/component reference; no decorative runtime added to a performance-sensitive chat. |
| [emilkowalski/skills](https://github.com/emilkowalski/skills) | Interaction-design reference; not installed globally. |
| [hallmark](https://github.com/Nutlope/hallmark) | Design critique reference; no additional global instructions installed. |
| [design.md](https://github.com/google-labs-code/design.md) | Durable visual-system documentation approach, recorded here. |
| [magicui](https://github.com/magicuidesign/magicui) | Animated component library; no new animation dependency required. |
| [gsap-skills](https://github.com/greensock/gsap-skills) | Animation guidance; no GSAP needed for these work screens. |
| [scroll-world](https://github.com/oso95/scroll-world) | Scrollable 3D landing pages do not fit conversation/navigation tasks. |
| [canvas-ui](https://github.com/DavidHDev/canvas-ui) | Canvas/WebGL effects do not address this app's readability/navigation problems. |
| [dimensional-drawing](https://github.com/enesozturk/dimensional-drawing) | UI illustration utility, not a functional workspace design system. |

These are assessed references, not claims that all 14 were installed or run.
Only the two named generator/search experiments were executed.

## Design decisions

The first question is: which conversation am I reading and directing? The
conversation gets the largest uninterrupted area. Jobs are secondary navigation;
questions and missing final responses stay visible as actionable state.

- Desktop: one framed reading surface, 780px reading measure on wide windows,
  quiet job rows rather than nested cards, restrained header, visible recipient
  caption, modest composer elevation, consistent light/dark and accent choices.
- Android: one compact conversation-scoped jobs strip opens the full hierarchy.
  Global jobs remain a separate explicit action. Nested-work preference and
  completed sections remain available inside the scoped panel.
- Android composer: full-width media-capable input, separate action row, one model
  selection sheet with search and effort chips. Touch controls retain native size.
- Both: collapsed tool activity by default, expandable original details; no
  automatic steer, duplicate result action, looping decorative animation, or
  invention of completed/accepted states.
- Queue cards display the complete message and distinguish waiting from explicit
  immediate steering. A message's recipient and result-delivery state are separate.

## Verification

Desktop fixtures cover light/dark, narrow windows, split panes with independent
drafts, job hierarchy/navigation and queue appearance. The existing long-session
performance fixture remains a gate (800 messages, typing, idle polling, append,
streaming). Android compile/unit/lint and native navigation/keyboard checks are
recorded separately from automated desktop verification in the delivery report.
