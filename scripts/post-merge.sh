#!/bin/bash
set -e
pnpm install --frozen-lockfile
echo "Template schema changes require review and an isolated blank database; automatic database push is disabled."
