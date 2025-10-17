# Pankha GitHub Repository Guide

Complete guide to the Pankha GitHub repository structure, workflow, and release process.

## Table of Contents
- [Repository Structure](#repository-structure)
- [Development Workflow](#development-workflow)
- [Release Process](#release-process)
- [Git Commands Reference](#git-commands-reference)
- [Best Practices](#best-practices)

---

## Repository Structure

Pankha uses a **two-repository architecture** to separate active development from stable releases.

### Development Repository: `pankha-dev`
**URL**: https://github.com/Anexgohan/pankha-dev

**Visibility**: **Private** (development team only)

**Purpose**: Active development, testing, and experimental features

**Local Directory**: `/root/anex/dev/pankha-dev/`

**Docker Configuration**:
```yml
# compose.yml in pankha-dev
services:
  pankha-app:
    build:
      context: .
      dockerfile: docker/Dockerfile
```
- Builds locally from source code
- Tests Docker builds before release

**Characteristics**:
- Contains work-in-progress code
- Frequent commits with incremental changes
- May include experimental features
- Testing ground for new functionality
- Updated multiple times per day
- Private access only

**Use For**:
- Feature development
- Bug fixes
- Testing new ideas
- Documentation updates
- Development iterations
- Pre-release verification

---

### Production Repository: `pankha`
**URL**: https://github.com/Anexgohan/pankha

**Visibility**: **Public** (open source, community access)

**Description**: "central self hosted management of fans for all clients - release repo"

**Local Directory**: `/root/anex/dev/pankha/`

**Docker Configuration**:
```yml
# compose.yml in pankha
services:
  pankha-app:
    image: anexgohan/pankha:latest
```
- Pulls pre-built images from Docker Hub
- Ready for immediate deployment

**Characteristics**:
- Contains only stable, tested code
- Infrequent, versioned releases
- Production-ready deployments
- Public-facing stable releases
- Well-documented, tested features
- Open source community access

**Use For**:
- Stable releases
- Production deployments
- Public distribution
- Version-tagged releases
- Community contributions

---

## Development Workflow

### Standard Development Cycle

```bash
# STEP 1: Work in Development Environment
cd /root/anex/dev/pankha-dev/

# Make code changes
# - Edit backend/frontend code
# - Update agent code
# - Write documentation

# STEP 2: Test Changes Locally
# Test backend
cd backend
npm run dev

# Test frontend
cd ../frontend
npm run dev

# Test Docker build
docker compose build --no-cache
docker compose up -d

# STEP 3: Commit Changes
git add .
git commit -m "Brief description of changes"

# STEP 4: Push to Development Repository
git push origin main

# STEP 5: Deploy to Development Server (if needed)
# SSH to 192.168.100.237
ssh root@192.168.100.237
cd /root/anex/dev/pankha-dev
git pull origin main
docker compose down
docker compose build --no-cache
docker compose up -d
```

---

## Release Process

### When to Release

Release to the production repository when:
- ✅ Feature is complete and tested
- ✅ All tests pass
- ✅ Documentation is updated
- ✅ No known critical bugs
- ✅ Production deployment is successful
- ✅ Code has been reviewed

### Release Workflow

```bash
# STEP 1: Verify Development Repository is Ready
cd /root/anex/dev/pankha-dev/
git status  # Ensure clean working tree
git log --oneline -5  # Review recent commits

# STEP 2: Test Docker Build in Development
cd /root/anex/dev/pankha-dev/
docker compose build --no-cache
docker compose up -d
# Test thoroughly to ensure everything works

# STEP 3: Build and Push Docker Image to Docker Hub
docker build -t anexgohan/pankha:latest -f docker/Dockerfile .
docker push anexgohan/pankha:latest

# Optional: Tag specific version
docker tag anexgohan/pankha:latest anexgohan/pankha:v1.0.0
docker push anexgohan/pankha:v1.0.0

# STEP 4: Switch to Production Repository
cd /root/anex/dev/pankha/

# STEP 5: Pull Latest from Production Repo
git pull origin main

# STEP 6: Merge Changes from Development
# Option A: Cherry-pick specific commits from pankha-dev
cd /root/anex/dev/pankha-dev/
git log --oneline -10  # Find commit hashes to cherry-pick

cd /root/anex/dev/pankha/
git cherry-pick <commit-hash>  # Repeat for each commit

# Option B: Manually copy changes (recommended for major releases)
# Copy files from pankha-dev to pankha
rsync -av --exclude='.git' --exclude='node_modules' --exclude='dist' \
  /root/anex/dev/pankha-dev/ /root/anex/dev/pankha/

# STEP 7: Test Production Release with Docker Hub Image
cd /root/anex/dev/pankha/
docker compose pull  # Pull the image we just pushed
docker compose up -d
# Test thoroughly

# STEP 8: Create Release Commit
git add .
git commit -m "Release v1.x.x: Brief release description

- Feature 1: Description
- Feature 2: Description
- Bug fixes: List major fixes
"

# STEP 9: Tag the Release
git tag -a v1.0.0 -m "Version 1.0.0 - Production Release"

# STEP 10: Push to Production Repository
git push origin main
git push origin v1.0.0  # Push the tag
```

---

## Git Commands Reference

### Common Operations

#### Checking Status
```bash
# View current status
git status

# View commit history
git log --oneline -10

# View changes
git diff

# View changes for specific file
git diff path/to/file
```

#### Committing Changes
```bash
# Stage all changes
git add .

# Stage specific file
git add path/to/file

# Commit with message
git commit -m "Description of changes"

# Amend last commit (if not pushed yet)
git commit --amend -m "Updated message"
```

#### Pushing to GitHub
```bash
# Push to development repository
cd /root/anex/dev/pankha-dev/
git push origin main

# Push to production repository
cd /root/anex/dev/pankha/
git push origin main

# Push tags
git push origin --tags
```

#### Pulling Updates
```bash
# Pull latest changes from GitHub
git pull origin main

# Fetch without merging
git fetch origin
```

#### Cherry-Picking Commits
```bash
# Find commit hash from pankha-dev
cd /root/anex/dev/pankha-dev/
git log --oneline -10

# Cherry-pick to pankha
cd /root/anex/dev/pankha/
git cherry-pick abc1234  # Replace with actual commit hash
```

#### Tagging Releases
```bash
# Create annotated tag
git tag -a v1.0.0 -m "Version 1.0.0 release notes"

# List tags
git tag -l

# Push tags to GitHub
git push origin --tags

# Delete local tag
git tag -d v1.0.0

# Delete remote tag
git push origin --delete v1.0.0
```

---

## Best Practices

### Commit Messages

**Format**:
```
Brief summary (50 chars or less)

Detailed explanation of changes:
- What was changed
- Why it was changed
- Any breaking changes
- Related issue numbers
```

**Good Examples**:
```
Add production Linux agent with real hardware integration

- Implemented sensor discovery for k10temp, it8628, nvme
- Added PWM fan control with RPM feedback
- WebSocket bidirectional communication
- Tested on AMD Ryzen 9 3900X (25 sensors, 5 fans)
```

```
Fix dropdown auto-closing during real-time updates

- Prevent dropdowns from closing when state updates
- Maintain dropdown state using refs
- Resolves issue #123
```

**Bad Examples**:
```
fix bug          # Too vague
Updated files    # What files? Why?
WIP             # Never commit work-in-progress to main
```

---

### Branching Strategy

**Development Repository (pankha-dev)**:
- **main**: Active development branch
- Feature branches: Optional for major features
```bash
git checkout -b feature/fan-profiles
# Work on feature
git checkout main
git merge feature/fan-profiles
git push origin main
```

**Production Repository (pankha)**:
- **main**: Stable releases only
- **No feature branches**: Only merge tested, stable code

---

### What NOT to Commit

#### Never Commit:
```bash
# Sensitive data
.env
*.key
*.pem
credentials.json
config/secrets.json

# Database files
backend/database/postgres_data/
*.sql  # (unless it's migration scripts)

# Dependencies
node_modules/
venv/
__pycache__/

# Build outputs
dist/
build/
*.log

# IDE files
.vscode/
.idea/
*.swp
```

#### Verify Before Pushing:
```bash
# Check what's staged
git status

# Review changes
git diff --cached

# Check for sensitive data
grep -r "password\|secret\|key" --include="*.json" --include="*.env"
```

---

### Security Checklist

Before pushing to GitHub:
- [ ] No passwords or API keys in code
- [ ] No database credentials
- [ ] No production .env files
- [ ] No sensitive user data
- [ ] .gitignore is up to date
- [ ] Database files excluded (postgres_data/)

---

## Repository Comparison

| Aspect | pankha-dev | pankha |
|--------|-----------|--------|
| **Purpose** | Development/Testing | Stable Releases |
| **Visibility** | Private | Public (open source) |
| **Update Frequency** | Multiple times/day | Weekly/Monthly |
| **Code Quality** | Work-in-progress | Production-ready |
| **Testing** | Active testing | Fully tested |
| **Commits** | Frequent, small | Infrequent, versioned |
| **Docker Build** | Local build from Dockerfile | Pre-built from Docker Hub |
| **Docker Image** | Built on-demand | `anexgohan/pankha:latest` |
| **Local Path** | `/root/anex/dev/pankha-dev/` | `/root/anex/dev/pankha/` |
| **GitHub URL** | github.com/Anexgohan/pankha-dev | github.com/Anexgohan/pankha |
| **Audience** | Development team | End users, community |

---

## Troubleshooting

### Push Rejected (Large Files)
```bash
# Error: File exceeds GitHub's 100MB limit
# Solution: Ensure postgres_data/ is in .gitignore

# Check .gitignore
cat .gitignore | grep postgres_data

# Remove from staging if accidentally added
git reset backend/database/postgres_data/

# Force remove from history (if already committed)
git filter-branch --tree-filter 'rm -rf backend/database/postgres_data' HEAD
```

### Merge Conflicts
```bash
# If conflicts occur during cherry-pick or merge
git status  # View conflicted files

# Edit conflicted files manually, then:
git add path/to/resolved-file
git cherry-pick --continue
# or
git merge --continue
```

### Undo Last Commit (Not Pushed)
```bash
# Keep changes, undo commit
git reset --soft HEAD~1

# Discard changes and commit
git reset --hard HEAD~1
```

### Undo Pushed Commit
```bash
# Create revert commit (safe, recommended)
git revert HEAD
git push origin main

# Force push (dangerous, avoid on shared repos)
git reset --hard HEAD~1
git push --force origin main
```

---

## Quick Reference

### Most Common Commands

```bash
# Daily development workflow
cd /root/anex/dev/pankha-dev/
git status
git add .
git commit -m "Description"
git push origin main

# Release to production
cd /root/anex/dev/pankha/
git pull origin main
# Copy/merge changes from pankha-dev
git add .
git commit -m "Release v1.x.x: Description"
git tag -a v1.x.x -m "Release notes"
git push origin main
git push origin --tags
```

---

## Additional Resources

- **Git Documentation**: https://git-scm.com/doc
- **GitHub Guides**: https://guides.github.com/
- **Semantic Versioning**: https://semver.org/
- **Conventional Commits**: https://www.conventionalcommits.org/

---

**Last Updated**: 2025-10-09
**Maintainer**: Development Team
**License**: AGPL-3.0
