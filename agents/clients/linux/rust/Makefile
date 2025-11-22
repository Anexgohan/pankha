.PHONY: all x86_64 aarch64 clean help

all: x86_64 aarch64

x86_64:
	@echo "Building x86_64..."
	cargo build --release
# 	Optional: Copy to custom output directory
	mkdir -p output/
	cp target/release/pankha-agent-linux output/pankha-agent-linux_x86_64
	@echo "✓ Copied to: output/pankha-agent-linux_x86_64"

aarch64:
	@echo "Building aarch64..."
	cargo build --release --target aarch64-unknown-linux-gnu
# 	Optional: Copy to custom output directory
	mkdir -p output/
	cp target/aarch64-unknown-linux-gnu/release/pankha-agent-linux output/pankha-agent-linux_arm64
	@echo "✓ Copied to: output/pankha-agent-linux_arm64"

clean:
	cargo clean
	# Optional: Clean custom output directories
	# Uncomment if you enabled custom output directories above
	# rm -rf output

help:
	@echo "Pankha Agent Build System"
	@echo ""
	@echo "Usage:"
	@echo "  make all      - Build both x86_64 and aarch64 binaries"
	@echo "  make x86_64   - Build only x86_64 binary"
	@echo "  make aarch64  - Build only aarch64 binary"
	@echo "  make clean    - Remove all build artifacts"
	@echo "  make help     - Show this help message"
	@echo ""
	@echo "Output locations:"
	@echo "  x86_64:  output/pankha-agent-linux_x86_64"
	@echo "  aarch64: output/pankha-agent-linux_arm64"
	@echo ""

