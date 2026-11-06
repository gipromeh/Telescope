# Local YouGile KB UI publisher

This is an experimental Windows-side publisher for meeting notes from the public Telescope repository. It uses a separate Playwright browser profile and the normal YouGile page interface. It does not use undocumented YouGile endpoints, MCP write tools, or a GitHub self-hosted runner.

## Destination and trigger

The publisher reads Markdown files from `MEETINGS/TO_PUBLISH/` on `main` every five minutes and creates a new page under:

**Проектирование САО → База знаний 12° Объектив → Совещания**

The page title comes from the filename with a trailing `_meeting` removed. Example: `2026-11-06_meeting.md` becomes `2026-11-06`.

An exact-title page already in the meetings section is skipped. Existing Knowledge Base pages are never edited or deleted. The local state file stores processed GitHub file hashes; if it is removed, duplicate detection still checks page titles before creating a page.

## First run

From this directory:

```powershell
npm install
npm run install:browser
npm run setup
npm run inspect-ui
npm run dry-run
```

- `npm run setup` opens a dedicated browser profile at YouGile. Sign in manually. Credentials are not read or stored by this program; the browser's local profile retains the session.
- `npm run inspect-ui` opens the separate browser profile, navigates to the configured project/Knowledge Base/section, and checks the Add page control. It does not open the editor or create a page.
- `npm run dry-run` checks the GitHub queue and prints page titles only. It does not open YouGile or create pages.
- After confirming the dry-run output and the YouGile session, run `install-windows.ps1` from PowerShell in this folder. It registers a per-user Windows task that starts the publisher at sign-in. The task runs `npm run publish` behavior continuously and checks GitHub every five minutes.
- The computer must be on and the Windows user signed in for the browser job to run. Logs are written to `%LOCALAPPDATA%\\Telescope\\YouGileKbPublisher\\publisher.log`. If it was off, queued files are discovered at the next sign-in.

To remove the scheduled task, open Windows Task Scheduler and delete **Telescope YouGile KB Publisher**.

## Safety and limits

- Publishing is disabled unless the process receives `--publish`. The default is a single dry-run.
- The publisher reads only Markdown queue files from the public repository and prints no meeting text to logs.
- It writes only by using the YouGile UI. If the expected project, Knowledge Base, section, editors, or Save control cannot be found, it stops before saving.
- Source text is inserted verbatim as plain text; Markdown styling is not converted to YouGile rich text in this version.
- A changed file at a previously published path is not used to overwrite the existing page. Use a new unique filename for a corrected or revised protocol.
- The browser profile contains an active YouGile session and stays in the current Windows user profile under local application data. Protect that Windows account and do not copy or commit the profile.
- This is an unofficial UI automation workaround. Interface changes can require code updates.
- Because Telescope is a public GitHub repository, this design avoids a self-hosted GitHub Actions runner. GitHub warns that untrusted pull requests can compromise self-hosted runner machines.

This initial code must be exercised with `npm run inspect-ui` and in dry-run mode before the scheduled job is enabled. The UI check verifies navigation and the Add page control, but does not verify editor fields or save behavior. It does not approve meeting proposals or change engineering requirements.
