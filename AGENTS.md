# Repository Guidelines

## Project Structure & Module Organization

This is a planning repository for a mobile-first voice assistant; calling, customer storage, and email delivery are not implemented.

- `README.md`: project status, overview, and publication boundaries.
- `PLAN.md`: proposed architecture, costs, implementation sequence, acceptance criteria, and sources.
- `docs/index.html`: public GitHub Pages overview with embedded CSS.
- `docs/.nojekyll`: disables Jekyll processing for the static site.
- `.gitignore`: excludes credentials, private data, generated reports, and local artifacts.

No application source, test, or separate asset directories exist yet. TypeScript and SQLite are proposed choices, not installed dependencies.

## Build, Test, and Development Commands

Run commands from the repository root:

- `python3 -m http.server 8000 --bind 127.0.0.1 --directory docs`: preview the public overview at `http://127.0.0.1:8000` using Python 3.
- `git diff --check`: detect whitespace errors before committing.
- `git diff --stat` and `git diff`: review change scope and content.

There is no build step, package manifest, lint command, or automated test runner.

## Coding Style & Naming Conventions

Use concise Markdown with descriptive headings, relative repository links, and fenced command examples. Match the existing HTML indentation of two spaces inside `<head>` and `<main>`; preserve semantic markup, responsive layouts, and visible keyboard focus. Keep the overview self-contained with embedded CSS and system fonts. No formatter or linter is configured. Cite sources and review dates for changing product capabilities or prices.

## Testing Guidelines

For documentation edits, verify links and consistency between the README, plan, and overview. For page edits, preview mobile and desktop widths and check keyboard navigation. No test framework, naming convention, or coverage threshold exists. When implementing services, add reproducible tests guided by the acceptance criteria in [PLAN.md](PLAN.md#8-implementation-sequence-and-acceptance-criteria).

## Commit & Pull Request Guidelines

The single existing commit uses an imperative, descriptive subject: “Document voice agent architecture, costs, and implementation plan.” Follow that style. Pull requests should explain the change, reference relevant issues or plan sections, record validation, and include screenshots for visible page changes.

## Security & Configuration

Follow [README.md](README.md) and [PLAN.md](PLAN.md#7-data-and-operational-requirements): publish only the overview from `docs/`. Never commit customer information, credentials, transcripts, reports, or private operational configuration. Review staged content; ignore rules do not protect already tracked files. Keep planned capabilities explicitly labeled as proposed.
