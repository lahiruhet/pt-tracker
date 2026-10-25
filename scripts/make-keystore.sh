#!/usr/bin/env bash
# One-off: create the APK signing key and store it as GitHub Actions secrets, so every CI build
# is signed with the same key and installs over the previous version.
# Needs: Java (keytool), GitHub CLI logged in with admin rights on the repo.
#   scripts/make-keystore.sh lahiruhet/pt-tracker
set -euo pipefail
REPO="${1:?usage: make-keystore.sh owner/repo}"
DIR="$(mktemp -d)"
PASS="$(openssl rand -base64 24 | tr -d '/+=')"
keytool -genkeypair -v -keystore "$DIR/release.keystore" -alias pttracker -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$PASS" -keypass "$PASS" -dname "CN=PT Tracker, O=stackmoth, C=AE" >/dev/null
base64 -w0 "$DIR/release.keystore" | gh secret set ANDROID_KEYSTORE_BASE64 -R "$REPO"
printf '%s' "$PASS" | gh secret set ANDROID_KEYSTORE_PASSWORD -R "$REPO"
printf '%s' "$PASS" | gh secret set ANDROID_KEY_PASSWORD -R "$REPO"
printf 'pttracker' | gh secret set ANDROID_KEY_ALIAS -R "$REPO"
echo "Secrets set. Keep a backup of $DIR/release.keystore and the password somewhere safe (password manager):"
echo "  password: $PASS"
