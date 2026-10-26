# Isolated composer check

Start Vite on an unused local port, then open `/test/fixtures/attachments.html`.
The fixture mounts the real app with an in-memory transport. It cannot send real
messages, spawn tasks or access credentials. Uploads appear in `window.qaUploads`.

Check image paste, text paste, file drop, image preview/removal and file limits.
Automated input validation checks run with `npm test` in `apps/desktop`.
