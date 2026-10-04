"""Pure hard caps for autonomous worker tasks (turns, tokens, wall time, USD, strikes)."""
import time
from collections.abc import Callable
from dataclasses import dataclass, field

CONTINUE = "CONTINUE"
PARK = "PARK"
TOKEN_WARN_FRACTION = 0.85


@dataclass(frozen=True)
class TaskCaps:
    max_turns: int = 25
    max_input_tokens: int = 400000
    max_wall_seconds: float = 1800
    max_usd: float = 0.50
    strike_limit: int = 3


@dataclass(frozen=True)
class CapAction:
    action: str = CONTINUE
    reason: str = ""
    warnings: tuple = ()

    @property
    def parked(self) -> bool:
        return self.action == PARK


@dataclass
class CapTracker:
    caps: TaskCaps = field(default_factory=TaskCaps)
    clock: Callable[[], float] = time.monotonic
    turns: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    usd: float = 0.0
    strikes: int = 0
    last_error: str | None = None
    started: float | None = None

    def __post_init__(self):
        if self.started is None:
            self.started = self.clock()

    def elapsed(self) -> float:
        return self.clock() - self.started

    def record(self, turn: int, tokens_in: int, tokens_out: int, usd: float,
               error_signature: str | None = None) -> CapAction:
        """Record one turn (token/usd values are per-turn deltas; turn is absolute)."""
        self.turns = max(self.turns, turn)
        self.tokens_in += tokens_in
        self.tokens_out += tokens_out
        self.usd += usd
        if error_signature:
            self.strikes = self.strikes + 1 if error_signature == self.last_error else 1
            self.last_error = error_signature
        else:
            self.strikes, self.last_error = 0, None
        c = self.caps
        if self.turns > c.max_turns:
            return CapAction(PARK, f"max_turns {c.max_turns} exceeded")
        if self.tokens_in > c.max_input_tokens:
            return CapAction(PARK, f"max_input_tokens {c.max_input_tokens} exceeded")
        if self.elapsed() > c.max_wall_seconds:
            return CapAction(PARK, f"max_wall_seconds {c.max_wall_seconds:g} exceeded")
        if self.usd > c.max_usd:
            return CapAction(PARK, f"max_usd {c.max_usd:.2f} exceeded")
        if self.strikes >= c.strike_limit:
            return CapAction(PARK, f"{self.strikes} consecutive identical errors")
        warnings = ()
        if self.tokens_in >= c.max_input_tokens * TOKEN_WARN_FRACTION:
            warnings = ("input tokens at 85% of budget",)
        return CapAction(CONTINUE, "", warnings)
