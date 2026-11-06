# Local YouGile Knowledge Base publisher

This tool is an experimental Windows-side browser publisher for meeting notes in the public Telescope repository. It does not use the undocumented YouGile API, MCP write tools, or a GitHub self-hosted Actions runner.

The local process polls `MEETINGS/TO_PUBLISH/` on `main` every five minutes. In publish mode it opens a separate Playwright browser profile, navigates the YouGile interface, and creates a page under **Проектирование САО → База знаний 12° Объектив → Совещания**. It never stores a YouGile password or token in the repository or GitHub Secrets. On first setup, the user signs in manually in the separate browser profile.

## Safety behavior

- With no arguments, the tool runs one dry-run scan and does not open YouGile or write data.
- `--publish` is required for page creation.
- `--watch` repeats the scan every five minutes.
- A page with the same exact title is skipped; existing pages are not overwritten.
- The local state file records published file hashes so unchanged files are not submitted again.
- Meeting file contents are not printed in logs.
- If the expected editors or controls are not present, the tool stops before clicking Save.
- The Markdown source is entered as text. Markdown styling is not converted to YouGile rich-text formatting in this initial version.

The UI selectors are based on the current YouGile screen and must be checked in a dry run before enabling the scheduled publisher. Changes to YouGile's interface may require selector updates.

## One-time setup

1. Install Node.js 22 or newer.
2. In this directory, run `npm install`.
3. Run `npm run setup`. A separate browser opens at YouGile. Sign in yourself; the script does not read or type credentials. Press Enter in the terminal after the project is visible.
4. Run `npm run dry-run` and confirm it sees the queue files without publishing anything.
5. To publish automatically, run `install-windows.ps1` from PowerShell in this directory. It registers a per-user Task Scheduler job to start at the next Windows sign-in. The computer must be on, the user signed in, and the network available. The task uses an interactive browser session.
6. To verify or remove the task, open Windows Task Scheduler and find **Telescope YouGile KB Publisher**.

The separate browser profile and publisher state are stored under the current user's local application data, outside the repository. Protect the Windows user account; do not copy or commit the profile. If a page already exists, the tool skips it. To publish a corrected protocol as a new page, use a new unique filename.

## Add a protocol to the queue

After this change is merged, add a Markdown file such as:

`MEETINGS/TO_PUBLISH/2026-11-06_meeting.md`

The resulting page title is the filename without `_meeting.md`. Each meeting should use a unique filename. The local publisher discovers additions from `main`; it does not act on pull-request branches.

## Limitations

This is a UI automation workaround, not a supported YouGile integration. It needs a signed-in local browser profile and can stop working if YouGile changes its page structure. The tool creates pages only; it does not edit, delete, approve, or revise engineering documents. Do not use it to turn meeting proposals into approved requirements.
