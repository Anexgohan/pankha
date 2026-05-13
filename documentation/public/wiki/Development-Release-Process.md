# Release Process

How Pankha publishes releases. Releases are tagged manually; the body is composed automatically from PR labels.

---

## Prerequisites

*   Push access to the `Anexgohan/pankha` repository
*   `gh` CLI authenticated for the optional manual dispatch path

---

## Routine Release

Most releases need no authoring — just tag and push:

```bash
cd /root/anex/dev/pankha
git checkout main && git pull
git tag v0.4.25
git push --tags
```

GitHub Actions then:

1.  Builds Rust agents (x64, ARM64, IPMI), Windows MSI, Docker images (amd64 + arm64)
2.  Generates a categorised PR list from labels since the previous matching release
3.  Composes the release body with install instructions
4.  Uploads binaries + checksums as release assets
5.  Publishes the GitHub Release

Total pipeline: ~10-15 minutes (Windows MSI is the long pole).

---

## Release with Custom Highlights

For bigger releases that deserve a headline, edit the input template before tagging:

```bash
$EDITOR .github/input/release-notes.md
```

The file has commented sections for `Highlights`, `Breaking Changes`, `Screenshots`, and `Notes`. Delete what you don't need, write into what you keep.

### Embedding screenshots

Drop image files into `.github/input/images/` and reference them in `release-notes.md`:

```markdown
![Caption](./images/your-screenshot.png)
```

On release, the workflow uploads each image as a release asset and rewrites the URL to its permanent `releases/download/...` path.

### Then tag and push

```bash
git add .github/input/
git commit -m "docs: stage release notes for v0.4.25"
git push
git tag v0.4.25 && git push --tags
```

After the release publishes, the workflow resets `release-notes.md` to the template and clears `images/` automatically via a follow-up commit to main.

---

## Pre-release vs Stable

The pipeline auto-detects pre-releases from the tag name:

| Tag pattern | Treated as | Docker tags updated |
|---|---|---|
| `v1.2.3` | Stable | `:latest`, `:beta`, versioned |
| `v1.2.3-alpha`, `-beta`, `-rc`, `-pre`, `-preview`, `-dev`, `-canary`, `-nightly`, `-experimental`, `-insiders`, `-test`, `-testing` | Pre-release | `:beta`, `:testing`, versioned (NOT `:latest`) |

Pre-releases are marked as such on the GitHub Releases page.

---

## How the Body is Composed

The release body is structured as:

```
[Authored highlights — if release-notes.md was edited]

## What's Changed
### Features          # PRs labelled 'feature'
### Bug Fixes         # PRs labelled 'fix'
### Frontend / Backend / Agent Linux / ...   # alphabetical by label

<details>
<summary>Dependencies, CI, and chores</summary>
... folded PRs (dependencies always, plus ci/devops/chore-only)
</details>

[Install instructions — Docker, Linux x64/ARM64, Windows MSI, IPMI]

**Full Changelog**: vPREV...vCURRENT
```

### Diff base (which PRs get included)

*   **Stable tag** (`v1.2.3`): diff against the previous stable, skipping pre-releases. So `v1.2.3` notes summarise everything since `v1.2.2`, including all the alphas and betas in between.
*   **Pre-release tag** (`v1.2.3-beta3`): diff against the immediately previous tag of any kind. So beta3 only shows what's new since beta2.

### Categorisation

Categories are driven by PR labels, applied automatically by `pr-labeler.yml`:

*   **Top tier** (intent labels): `breaking-change`, `feature`, `fix`
*   **Middle tier** (area labels, alphabetical): `agent-linux`, `agent-windows`, `backend`, `database`, `docker`, `frontend`, `license`, `vendor-profiles`, `documentation`
*   **Folded** under `<details>`: PRs labelled `dependencies` (always), or PRs labelled only with `ci`/`devops`/`chore`
*   **Other Changes**: unlabelled PRs (trailing)

Adding a new label later automatically gets its own section — no code change required.

---

## Refresh an Existing Release Body

If you spot a typo or want to update notes on a published release without rebuilding everything:

```bash
gh workflow run release-notes.yml --ref main \
  -f version=v0.4.25 \
  -f update_existing_release=true
```

Re-composes the body and applies it to the existing release in ~30 seconds. No agents rebuilt, no Docker images touched.

---

## Release Assets

Every release publishes:

*   `pankha-agent-linux_x64`
*   `pankha-agent-linux_arm64`
*   `pankha-agent-ipmi-linux_x64`
*   `pankha-agent-windows_x64.msi`
*   `config.example.json`
*   `compose.yml`
*   `example.env`
*   `checksums.txt` (SHA256 of all of the above)

Plus the Docker images tagged on Docker Hub (`anexgohan/pankha:vX.Y.Z` and rolling tags).

---

## Verifying After Publish

```bash
gh release view v0.4.25
# Should show: 8 assets, correct title, body with categorised PRs
```

If anything looks wrong, re-run notes (see above) before retrying the build.
