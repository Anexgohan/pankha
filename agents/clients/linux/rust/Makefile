.PHONY: all x86_64 aarch64 clean help

# Version can be passed as: make VERSION=0.4.24-alpha2 all
# 4-part versions (0.1.7.2) auto-convert to SemVer prerelease (0.1.7-2)
# example:
#   cd /path/to/agents/clients/linux/rust/ && make clean && make VERSION=0.2.19-dev all
#
# The VERSION value is forwarded to cargo as PANKHA_VERSION (consumed by build.rs).
# Cargo.toml is NEVER mutated - the version is embedded into the binary at compile time.
VERSION ?=

# Compute PANKHA_VERSION from VERSION: strip 'v', convert 4-part → prerelease
ifdef VERSION
  RAW_VER := $(shell echo "$(VERSION)" | sed 's/^v//')
  DOT_COUNT := $(shell echo "$(RAW_VER)" | tr -cd '.' | wc -c)
  ifeq ($(shell [ $(DOT_COUNT) -ge 3 ] && echo yes),yes)
    PANKHA_VERSION := $(shell echo "$(RAW_VER)" | sed 's/^\([0-9]*\.[0-9]*\.[0-9]*\)\.\([0-9]*\)/\1-\2/')
  else
    PANKHA_VERSION := $(RAW_VER)
  endif
  export PANKHA_VERSION
endif

all: x86_64 aarch64

x86_64:
	@echo "Building x86_64..."
ifdef VERSION
	@echo "PANKHA_VERSION=$(PANKHA_VERSION)"
endif
	cargo build --release --locked
	mkdir -p output/
	cp target/release/pankha-agent-linux output/pankha-agent-linux_x86_64
	@echo "✓ Copied to: output/pankha-agent-linux_x86_64"
ifdef VERSION
	@echo "✓ Version: $(PANKHA_VERSION)"
endif

aarch64:
	@echo "Building aarch64..."
ifdef VERSION
	@echo "PANKHA_VERSION=$(PANKHA_VERSION)"
endif
	cargo build --release --target aarch64-unknown-linux-gnu --locked
	mkdir -p output/
	cp target/aarch64-unknown-linux-gnu/release/pankha-agent-linux output/pankha-agent-linux_arm64
	@echo "✓ Copied to: output/pankha-agent-linux_arm64"
ifdef VERSION
	@echo "✓ Version: $(PANKHA_VERSION)"
endif

clean:
	cargo clean
	# Optional: Clean custom output directories
	# rm -rf output

help:
	@echo "Pankha Agent Build System"
	@echo ""
	@echo "Usage:"
	@echo "  make all                          - Build both x86_64 and aarch64 (version=0.0.0-dev)"
	@echo "  make x86_64                       - Build only x86_64 binary"
	@echo "  make aarch64                      - Build only aarch64 binary"
	@echo "  make VERSION=0.4.24-alpha2 all    - Build with specific version"
	@echo "  make VERSION=0.4.24-alpha2 x86_64 - Build x86_64 with specific version"
	@echo "  make clean                        - Remove all build artifacts"
	@echo "  make help                         - Show this help message"
	@echo ""
	@echo "Output locations:"
	@echo "  x86_64:  output/pankha-agent-linux_x86_64"
	@echo "  aarch64: output/pankha-agent-linux_arm64"
	@echo ""
