#!/bin/bash
# Setup script for DDD Driver Card Reader
# Requires: Go 1.21+, Python 3.10+

set -e

echo "=== Building tachoparser (dddparser) ==="
TMPDIR=$(mktemp -d)
git clone https://github.com/traconiq/tachoparser.git "$TMPDIR/tachoparser"
cd "$TMPDIR/tachoparser"

# Create minimal certificate directories (signatures won't be verified without real keys)
mkdir -p internal/pkg/certificates/pks1 internal/pkg/certificates/pks2
touch internal/pkg/certificates/pks1/dummy.bin internal/pkg/certificates/pks2/dummy.bin

go build -o dddparser ./cmd/dddparser/
sudo cp dddparser /usr/local/bin/dddparser
cd -
rm -rf "$TMPDIR"

echo "=== Installing Python dependencies ==="
pip3 install -r requirements.txt

echo ""
echo "Setup complete! Run the app with:"
echo "  python3 app.py"
echo ""
echo "Then open http://localhost:5000 in your browser."
