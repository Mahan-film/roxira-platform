#!/usr/bin/env bash
# Exits as soon as a free OpenCode model answers or a DeepSeek key appears. Gives up after 32 h.
cd /tmp/claude-1000/-home-mahan/f2518bd6-88c0-49c6-9221-7d6f30b97be2/scratchpad || exit 2
for i in $(seq 1 96); do
  if grep -qsE 'deepseek|openrouter|mistral|sambanova' ~/.local/share/opencode/auth.json || grep -qsE '^(export )?[A-Z_]+_API_KEY=.' ~/Secrets/roxira/roxira.env; then echo "key present"; exit 0; fi
  if timeout 60 ~/.local/bin/opencode run --model opencode/deepseek-v4.1-flash-free "Reply with exactly: READY" 2>/dev/null | grep -q READY; then echo "free model answering"; exit 0; fi
  sleep 1200
done
echo "gave up after 32h"; exit 1
