#!/usr/bin/env bash
# GIT_ASKPASS helper for codeberg_mirror.sh. Contains no secret: it answers git's credential
# prompt from the environment, and ONLY for codeberg.org (so the token can never be handed to
# GitHub or any other host that happens to ask).
#   Username prompt -> $CODEBERG_USER (default mahanofficial)
#   Password prompt -> $CODEBERG_TOKEN
case "${1:-}" in
  *codeberg.org*) ;;
  *) exit 1 ;;
esac
case "${1:-}" in
  Username*) printf '%s\n' "${CODEBERG_USER:-mahanofficial}" ;;
  Password*) [ -n "${CODEBERG_TOKEN:-}" ] || exit 1; printf '%s\n' "$CODEBERG_TOKEN" ;;
  *) exit 1 ;;
esac
