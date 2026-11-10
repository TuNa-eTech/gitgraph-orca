# Contributing

Thanks for helping improve Git Graph for Orca.

## Reporting a bug

Open an issue with:

- your Orca version (**Settings → About**) and operating system,
- the plugin version (the tag you installed),
- what you did, what you expected and what happened,
- the output of `orca plugin logs <plugin-key>` if the panel shows an error.

Remove anything private from logs and screenshots, such as remote URLs, branch names and emails.

## Proposing a change

For a new feature or a change in behaviour, open an issue first and describe the use case. Small fixes can go straight to a pull request.

## Working on the code

```sh
pnpm install
pnpm types
pnpm watch    # terminal 1
pnpm dev      # terminal 2: loads the folder into Orca
```

Conventions:

- **Requests:** the panel talks to the worker only through the requests declared in `src/shared/protocol.ts`. Add new requests there first.
- **Running Git:** Git runs only in the worker, through `src/worker/git/run.ts`, with argument arrays. Never build a shell string, and validate refs with the helpers in `src/worker/git/args.ts`.
- **Settings:** a new setting needs an entry in `contributes.settings` in `orca-plugin.json` and a default in `src/shared/settings.ts`. A test checks that the two match.
- **Panel UI:**
  - Use `IconButton` with a `label` for icon buttons. The label becomes the tooltip, so do not add `title` attributes.
  - Style with the `--orca-*` CSS variables so the panel follows the user's theme.
  - Make layouts respond to the panel's width with container queries.
- **Tests:** add a test in `src/worker/main.test.ts` for any new Git behaviour. Tests run against real temporary repositories.

Before opening the pull request, run:

```sh
pnpm typecheck && pnpm test && pnpm validate && pnpm build
```

and commit the rebuilt `dist/` along with your source changes.

## Releasing

Maintainers only:

1. Bump `version` in `orca-plugin.json` and `package.json`.
2. Commit, then tag the commit `vX.Y.Z` and push the tag.

The community catalog picks up the newest `vX.Y.Z` tag. A version that has been listed is permanent, so never move a tag.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
