#!/usr/bin/env bash
# compose-release-notes.sh — Build the GitHub Release body for a given version.
#
# Usage: compose-release-notes.sh <version>
#   <version> — tag name, e.g. v0.4.24 or v0.4.24-beta1
#
# Outputs:
#   body.md in $PWD
#   GITHUB_OUTPUT: body, has_images, release_type
#
# Requires: git, gh, jq, sed (all available on ubuntu-latest GitHub runners)

set -euo pipefail

VERSION="${1:?usage: $0 <version>}"
REPO="${GITHUB_REPOSITORY:-Anexgohan/pankha}"
INPUT_NOTES=".github/input/release-notes.md"
INPUT_TEMPLATE=".github/input/release-body-template.md"
INPUT_IMAGES=".github/input/images"

# ---------------------------------------------------------------------------
# 1. Resolve diff base (asymmetric: stable vs pre-release)
#    Works whether VERSION already exists as a tag (tag-push trigger) or not
#    (workflow_dispatch trigger before the tag is created).
# ---------------------------------------------------------------------------
ALL_TAGS=$(git tag --sort=-version:refname || true)
if [[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  RELEASE_TYPE="Release"
  CANDIDATES=$(echo "$ALL_TAGS" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' || true)
else
  RELEASE_TYPE="Pre-release"
  CANDIDATES="$ALL_TAGS"
fi
# Insert VERSION into the candidate list, version-sort descending, take the tag
# that lands immediately after VERSION in that order = the previous tag.
PREV=$( { echo "$VERSION"; echo "$CANDIDATES"; } | sort -V -r | grep -A1 "^${VERSION}$" | tail -1 || true)
[ "$PREV" = "$VERSION" ] && PREV=""
[ -z "$PREV" ] && PREV=$(git rev-list --max-parents=0 HEAD | head -1)
echo "Diff base: $PREV..$VERSION ($RELEASE_TYPE)"

# ---------------------------------------------------------------------------
# 2. Highlights priority: file (ReleaseTag match + non-empty) > tag annotation > none
#    The file's "ReleaseTag:" line declares which release(s) its prose belongs
#    to (shell glob, e.g. "v0.6.3*"). No match or no line = prose skipped, so
#    stale notes can never leak into the wrong release. No reset step needed.
# ---------------------------------------------------------------------------
HIGHLIGHTS=""
if [ -f "$INPUT_NOTES" ]; then
  TARGET=$(sed -nE 's/^[[:space:]]*ReleaseTag:[[:space:]]*//p' "$INPUT_NOTES" | head -1 | sed -E 's/[[:space:]]+$//')
  if [ -z "$TARGET" ]; then
    echo "::warning::${INPUT_NOTES} has no 'ReleaseTag:' line - authored notes skipped, using auto-generated notes only"
  else
    case "$VERSION" in
      $TARGET)
        echo "ReleaseTag '$TARGET' matches $VERSION - using authored notes"
        RAW=$(grep -vE '^[[:space:]]*ReleaseTag:' "$INPUT_NOTES" || true)
        STRIPPED=$(echo "$RAW" \
          | sed -E ':a;N;$!ba;s/<!--[^-]*(-[^-]+)*-->//g' \
          | sed -E '/^[[:space:]]*$/d; /^#/d')
        [ -n "$STRIPPED" ] && HIGHLIGHTS="$RAW"
        ;;
      *)
        echo "ReleaseTag '$TARGET' does not match $VERSION - authored notes skipped"
        ;;
    esac
  fi
fi
if [ -z "$HIGHLIGHTS" ]; then
  # Only read tag contents for ANNOTATED tags. For lightweight tags
  # (git tag X without -a -m), `--format='%(contents)'` returns the underlying
  # commit message, which would leak squash-merge commit bodies into highlights.
  TAG_TYPE=$(git cat-file -t "$VERSION" 2>/dev/null || true)
  if [ "$TAG_TYPE" = "tag" ]; then
    TAG_MSG=$(git tag -l --format='%(contents)' "$VERSION" 2>/dev/null | sed '/^$/d' || true)
    # Skip boilerplate annotations like "Release v0.4.23" auto-set by release-public.yml.
    LINE_COUNT=$(echo "$TAG_MSG" | wc -l)
    if [ -n "$TAG_MSG" ] && ! { [ "$LINE_COUNT" -le 1 ] && echo "$TAG_MSG" | grep -qE "^Release v[0-9]+\.[0-9]+\.[0-9]+"; }; then
      HIGHLIGHTS="$TAG_MSG"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 3. Rewrite image refs in highlights (./images/foo.png → release asset URL)
# ---------------------------------------------------------------------------
if [ -n "$HIGHLIGHTS" ]; then
  IMG_BASE="https://github.com/${REPO}/releases/download/${VERSION}"
  HIGHLIGHTS=$(echo "$HIGHLIGHTS" | sed -E "s|\]\(\./images/([^)]+)\)|](${IMG_BASE}/\1)|g")
fi

# ---------------------------------------------------------------------------
# 4. Pull PRs in the commit range
#    If VERSION already exists as a tag (real tag-push path, or local testing
#    of a historical release), use it as the upper bound — this lets the
#    script run accurately from main without a detached-HEAD checkout.
#    Otherwise (workflow_dispatch path with the tag not yet created), use HEAD.
# ---------------------------------------------------------------------------
if git rev-parse --verify "$VERSION" >/dev/null 2>&1; then
  UPPER="$VERSION"
else
  UPPER="HEAD"
fi
COMMIT_MSGS=$(git log "${PREV}..${UPPER}" --pretty=format:'%s' 2>/dev/null || true)
PR_NUMS=$(echo "$COMMIT_MSGS" | grep -oE '#[0-9]+' | tr -d '#' | sort -un || true)

echo "[]" > /tmp/prs.json
for n in $PR_NUMS; do
  pr=$(gh pr view "$n" --repo "$REPO" --json number,title,author,labels 2>/dev/null || true)
  if [ -n "$pr" ]; then
    jq --argjson p "$pr" '. + [$p]' /tmp/prs.json > /tmp/prs.json.tmp \
      && mv /tmp/prs.json.tmp /tmp/prs.json
  fi
done

# ---------------------------------------------------------------------------
# 5. Categorise PRs (labels themselves are dynamic; only tier rules hardcoded)
#    TOP:    breaking-change > feature > fix
#    MIDDLE: any other label, alphabetical
#    FOLD:   dependencies | ci | devops | chore (collapsed <details>)
#    OTHER:  no labels (trailing "Other Changes")
# ---------------------------------------------------------------------------
jq '
  def category:
    .labels | map(.name) as $L
    | (["ci","devops","chore"]) as $FOLD_OTHER
    | if   ($L | index("breaking-change")) then "breaking-change"
      elif ($L | index("feature"))         then "feature"
      elif ($L | index("fix"))             then "fix"
      # dependencies always folds (after top-tier intent labels), even when
      # Dependabot also tags it with area labels like "backend" or "rust".
      elif ($L | index("dependencies"))    then "_fold"
      elif ($L | length) == 0              then "_other"
      else
        # Pick the first real category label (ignoring ci/devops/chore noise).
        ($L | map(select(. as $l | $FOLD_OTHER | index($l) | not)) | sort) as $real
        | if ($real | length) > 0 then $real[0]
          else "_fold"
          end
      end;
  map(. + {_cat: category}) | group_by(._cat) | map({k:.[0]._cat, v:.})
' /tmp/prs.json > /tmp/grouped.json

# Render a section with capitalised heading
render_section() {
  local cat="$1"
  local items scope=0
  # Intent headings hide the platform, so prefix those items with the agents they touch.
  # Area headings (Agent Linux, ...) already carry the scope.
  case "$cat" in breaking-change|feature|fix) scope=1 ;; esac
  items=$(jq -r --arg c "$cat" --argjson scope "$scope" '
    def agent_scope:
      (.labels | map(.name)) as $L
      | [ ("Linux"   | select($L | index("agent-linux"))),
          ("Windows" | select($L | index("agent-windows"))),
          ("IPMI"    | select($L | index("agent-ipmi"))) ]
      | if   length == 0 then ""
        elif length == 1 then "**" + .[0] + " agent** - "
        else "**" + join(" + ") + " agents** - "
        end;
    .[] | select(.k==$c) | .v[]
    | (if $scope == 1 then agent_scope else "" end) as $s
    | "- " + $s + .title + " by @" + .author.login + " in #" + (.number|tostring)
  ' /tmp/grouped.json)
  [ -z "$items" ] && return
  local title
  # Title-case each hyphen-separated word: "agent-linux" -> "Agent Linux"
  title=$(echo "$cat" | awk -F'-' '{for(i=1;i<=NF;i++)$i=toupper(substr($i,1,1)) substr($i,2);print}' OFS=' ')
  case "$cat" in
    breaking-change) title="Breaking Changes" ;;
    feature)         title="Features" ;;
    fix)             title="Bug Fixes" ;;
    agent-ipmi)      title="Agent IPMI" ;;
    _other)          title="Other Changes" ;;
  esac
  echo "### $title"
  echo "$items"
  echo ""
}

{
  for cat in breaking-change feature fix; do render_section "$cat"; done
  jq -r '.[] | select(.k | startswith("_") | not)
        | select(.k as $k | (["breaking-change","feature","fix"] | index($k)) | not)
        | .k' /tmp/grouped.json | sort -u | while read -r cat; do
    [ -n "$cat" ] && render_section "$cat"
  done
  render_section "_other"

  fold_items=$(jq -r '.[] | select(.k=="_fold") | .v[] | "- " + .title + " by @" + .author.login + " in #" + (.number|tostring)' /tmp/grouped.json)
  if [ -n "$fold_items" ]; then
    echo "<details>"
    echo "<summary>Dependencies, CI, and chores</summary>"
    echo ""
    echo "$fold_items"
    echo ""
    echo "</details>"
    echo ""
  fi
} > /tmp/categorised.md

# ---------------------------------------------------------------------------
# 6. Compose final body
# ---------------------------------------------------------------------------
TEMPLATE=$(sed "s/{{VERSION}}/$VERSION/g; s/{{RELEASE_TYPE}}/$RELEASE_TYPE/g" "$INPUT_TEMPLATE")
HAS_CHANGES=false
[ -s /tmp/categorised.md ] && HAS_CHANGES=true

{
  if [ -n "$HIGHLIGHTS" ]; then
    echo "$HIGHLIGHTS"
    echo ""
  fi
  if [ "$HAS_CHANGES" = "true" ]; then
    echo "## What's Changed"
    echo ""
    cat /tmp/categorised.md
  fi
  echo "$TEMPLATE"
  echo ""
  echo "**Full Changelog**: https://github.com/${REPO}/compare/${PREV}...${VERSION}"
} > body.md

# ---------------------------------------------------------------------------
# 7. Export for workflow
# ---------------------------------------------------------------------------
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "body<<PANKHA_EOF"
    cat body.md
    echo "PANKHA_EOF"
  } >> "$GITHUB_OUTPUT"
  echo "release_type=$RELEASE_TYPE" >> "$GITHUB_OUTPUT"

  if [ -d "$INPUT_IMAGES" ] && ls -A "$INPUT_IMAGES" 2>/dev/null | grep -qv '^\.gitkeep$'; then
    echo "has_images=true" >> "$GITHUB_OUTPUT"
  else
    echo "has_images=false" >> "$GITHUB_OUTPUT"
  fi
fi

echo "Composed body.md ($(wc -l < body.md) lines)"
