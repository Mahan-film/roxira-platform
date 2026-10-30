"""Mocked architect/reviewer model: checks the prompt on stdin and prints a canned reply.

MOCK_REPLY = reply file; MOCK_EXPECT = text the prompt must contain (exit 3 otherwise);
MOCK_PROMPT_OUT = where to save the prompt for assertions.
"""
import os
import sys

prompt = sys.stdin.read()
if os.environ.get("MOCK_PROMPT_OUT"):
    open(os.environ["MOCK_PROMPT_OUT"], "w").write(prompt)
if os.environ.get("MOCK_EXPECT", "") not in prompt:
    sys.exit(3)
sys.stdout.write(open(os.environ["MOCK_REPLY"]).read())
