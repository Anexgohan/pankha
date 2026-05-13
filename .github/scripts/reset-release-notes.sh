#!/usr/bin/env bash
# reset-release-notes.sh — Restore .github/input/release-notes.md to its pristine
# template state after a release has been published. Called by the reset step
# in release-public.yml after a successful release.

set -euo pipefail

cat > .github/input/release-notes.md << 'TEMPLATE_EOF'
<!-- HOW THIS FILE WORKS:
     Edit sections below as you work toward a release. Delete the ones you don't need.
     If this file is empty or contains only this template (comments + empty headings),
     the release will use pure auto-generated categorised notes with no highlights block.

     Images: drop files into .github/input/images/ and reference them here as
       ![Caption](./images/your-screenshot.png)
     The workflow uploads each image as a release asset and rewrites the URL to
     the permanent releases/download/... URL automatically.

     After a release is published, this file resets to this template
     automatically and .github/input/images/ is cleared. The full body is
     preserved on the GitHub Release page; git log of this file preserves
     the authored prose per release. -->

## Highlights

<!-- Lead with 1-3 big things. Example:
- **IPMI Support (Alpha)**: Pankha now talks to /dev/ipmi0 on enterprise BMC servers.
  Currently supports Supermicro and Dell; HP is read-only. -->

## Breaking Changes

<!-- List behaviour changes for existing users. If none, write "None" or delete this section. -->

## Screenshots

<!-- ![Caption](./images/example.png) -->

## Notes

<!-- Migration steps, known issues, anything else worth calling out. -->
TEMPLATE_EOF

echo "Reset .github/input/release-notes.md to template"
