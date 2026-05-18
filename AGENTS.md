# AGENTS.md

This project is a Vite + React + Fastify + Prisma application.

Guidelines for coding agents:

- Use PowerShell-compatible commands on Windows examples.
- Prefer `rg` for search and `npm` scripts for validation.
- Do not commit `.env`, local databases, uploads, generated images, build output, or dependency folders.
- Run `npm run build` after changes that affect app code, server code, Prisma schema, or build configuration.
- Keep public documentation focused on reproducible local setup and avoid private deployment notes.
