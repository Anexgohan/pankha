.PHONY: all x86_64 aarch64 clean help inject-version reset-version

# Version can be passed as: make VERSION=0.1.7 all
# 4-part versions (0.1.7.2) will be auto-converted to 3-part (0.1.72)
VERSION ?=
DEFAULT_VERSION := 1.0.0

# Reset Cargo.toml to default version (fixes corrupted state)
reset-version:
	@echo "🔄 Resetting Cargo.toml to default version $(DEFAULT_VERSION)..."
	@sed -i 's/^version = ".*"/version = "$(DEFAULT_VERSION)"/' Cargo.toml
	@head -3 Cargo.toml

# Inject version into Cargo.toml if VERSION is provided
# Conversion rules:
#   0.1.7       → 0.1.7       (unchanged)
#   0.1.7.1     → 0.1.7-1     (4th part becomes prerelease)
#   v0.1.7.2    → 0.1.7-2     (strips 'v', converts to prerelease)
#   0.1.7.2-foo → 0.1.7-2-foo (preserves suffix)
inject-version:
ifdef VERSION
	@# Strip 'v' prefix if present, then convert 4-part to prerelease format
	@RAW_VER=$$(echo "$(VERSION)" | sed 's/^v//'); \
	DOTS=$$(echo "$$RAW_VER" | grep -o '\.' | head -3 | wc -l); \
	if [ "$$DOTS" -ge 3 ]; then \
		CARGO_VER=$$(echo "$$RAW_VER" | sed 's/^\([0-9]*\.[0-9]*\.[0-9]*\)\.\([0-9]*\)/\1-\2/'); \
		echo "⚠️  Converting: $(VERSION) → $$CARGO_VER (SemVer prerelease format)"; \
		sed -i "s/^version = \".*\"/version = \"$$CARGO_VER\"/" Cargo.toml; \
	else \
		echo "📝 Injecting version $$RAW_VER into Cargo.toml..."; \
		sed -i "s/^version = \".*\"/version = \"$$RAW_VER\"/" Cargo.toml; \
	fi
	@head -5 Cargo.toml
endif

all: inject-version x86_64 aarch64

x86_64: inject-version
	@echo "Building x86_64..."
	cargo build --release
#	Optional: Copy to custom output directory
	mkdir -p output/
	cp target/release/pankha-agent-linux output/pankha-agent-linux_x86_64
	@echo "✓ Copied to: output/pankha-agent-linux_x86_64"
ifdef VERSION
	@echo "✓ Version: $(VERSION)"
endif

aarch64: inject-version
	@echo "Building aarch64..."
	cargo build --release --target aarch64-unknown-linux-gnu
#	Optional: Copy to custom output directory
	mkdir -p output/
	cp target/aarch64-unknown-linux-gnu/release/pankha-agent-linux output/pankha-agent-linux_arm64
	@echo "✓ Copied to: output/pankha-agent-linux_arm64"
ifdef VERSION
	@echo "✓ Version: $(VERSION)"
endif

clean:
	cargo clean
	# Optional: Clean custom output directories
	# Uncomment if you enabled custom output directories above
	# rm -rf output

help:
	@echo "Pankha Agent Build System"
	@echo ""
	@echo "Usage:"
	@echo "  make all                    - Build both x86_64 and aarch64 binaries"
	@echo "  make x86_64                 - Build only x86_64 binary"
	@echo "  make aarch64                - Build only aarch64 binary"
	@echo "  make VERSION=0.1.7.2 all    - Build with specific version"
	@echo "  make VERSION=0.1.7.2 x86_64 - Build x86_64 with specific version"
	@echo "  make clean                  - Remove all build artifacts"
	@echo "  make help                   - Show this help message"
	@echo ""
	@echo "Output locations:"
	@echo "  x86_64:  output/pankha-agent-linux_x86_64"
	@echo "  aarch64: output/pankha-agent-linux_arm64"
	@echo ""

