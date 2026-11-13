# Wipster

Personal productivity system with a hard WIP limit, fast context capture,
and agent-assisted bulk edits.

Optional Google account, secondary SMS and cross-device sync: [architecture](docs/cloud-sync-contract.md), [local setup and operations](backend/README.md). Start the local PostgreSQL/API stack with `docker compose up --build -d --wait`; configure a Google Desktop OAuth client using [Google setup](docs/google-auth-setup.md). Desktop settings default to the confirmed API origin `https://wipster.fedotovs.net`; existing saved origins remain unchanged. SMS is opt-in. Cloud is optional; the original offline workspace remains intact.
