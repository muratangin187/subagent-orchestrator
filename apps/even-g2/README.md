# Agent Workspace · G2

Your persistent Codex assistant, on Even G2. Speak on the glasses, read replies, inspect jobs, and continue the same conversations from the phone.

**[Setup, architecture, gestures and testing →](../../docs/even-g2.md)**

```sh
npm ci
npm test
npm run build
npm run dev
# separate terminal
npm run simulator
```

Package for your own HTTPS workspace:

```sh
npm run pack -- https://your-workspace.your-tailnet.ts.net:9443
```

The app uses the official Even Hub SDK. Hardware validation and beta installation are required before daily use. It has no T3 dependency and bundles no personal credentials.
