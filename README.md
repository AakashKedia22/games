# games

A monorepo of card-game apps. Each game is a self-contained project with its
own `package.json`, server and README.

| Project | What it is | README |
|---|---|---|
| `begum-chor/` | Real-time multiplayer score tracker for **Begam Chor** (Call Bridge) with invite links, QR join and live scoring | [begum-chor/README.md](begum-chor/README.md) |
| `marriage-game/` | **Marriage Score Card**: house-rules scoring dashboard for the 3-deck Marriage card game, with per-card scoring, joker routes and offline photo card recognition | [marriage-game/README.md](marriage-game/README.md) |

## Running a project

Every project is independent — `npm install` (or reuse an existing
`node_modules`) and the usual scripts live inside its folder:

```sh
cd begum-chor && npm start        # CRA dev server + node server.mjs on :3001
cd marriage-game && npm start     # same pattern for the marriage score card
```

Common scripts in each project: `start` (dev), `prod` (build + single server
on :3001), `test` / `test:all` (jest + node server tests). `marriage-game`
additionally has `test:server`, `vision:test`, `vision:setup` and related
`vision:*` scripts for the card-recognition pipeline.

## Repo layout

- Both projects keep their own git history, merged here with
  `git merge --allow-unrelated-histories` after each history was rewritten
  into its subfolder (`git filter-repo --to-subdirectory-filter`).
- Heavy local-only artifacts (`node_modules`, `build`, `data`,
  `vision/.venv|datasets|models`) stay untracked; the HEIC capture photos in
  `marriage-game/img_data/` are tracked as detector fixtures.
