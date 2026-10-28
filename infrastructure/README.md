# Shared server infrastructure

This directory contains the one-time VPS setup and recovery reference under `initial-vps/`: host bootstrap/SSH hardening, shared Caddy gateway, and the original MyClinicHelper migration. Keep these server-wide files separate from routine application releases. They could later move to a dedicated infrastructure repository.

The existing server is already configured. Nothing here needs to be reapplied for a Stillkey update. The initial deployment script refuses an existing server installation to prevent an accidental combined redeployment.

For ordinary Stillkey releases, use `deployment/` at the repository root. Those bundles contain only Stillkey and its update/rollback scripts. Existing gateway routes, certificates, and other application containers stay outside the Stillkey release.
