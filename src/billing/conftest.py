"""Keep billing unit tests offline: pin the USD/Toman rate so pricing never hits the network
or reads a stale snapshot file. Tests of the rate logic itself delete this variable."""
import pytest


@pytest.fixture(autouse=True)
def _pin_usd_rate(monkeypatch):
    monkeypatch.setenv("SMARTJUDGE_USD_TOMAN_RATE", "280000")
