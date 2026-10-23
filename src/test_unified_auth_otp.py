"""OTP hardening for UnifiedAuthService (issue #366). In-memory store, fake clock, no network."""

from output_apps.ecosystem_core.src.auth import unified_auth_service as uas

PHONE = "09120000077"


class FakeClock:
    def __init__(self):
        self.now = 1_000_000.0

    def __call__(self):
        return self.now


class CapturingService(uas.UnifiedAuthService):
    def __init__(self, clock):
        super().__init__(store=uas.InMemoryOtpStore(clock), digest_key=b"k" * 32)
        self.sent = []

    def _deliver(self, phone, code):
        self.sent.append(code)


def _service():
    clock = FakeClock()
    return CapturingService(clock), clock


def test_code_is_six_digits_and_never_returned():
    svc, _ = _service()
    for _ in range(3):
        res = svc.generate_sms_otp(PHONE)
        code = svc.sent[-1]
        assert len(code) == 6 and code.isdigit()
        assert code not in repr(res) and "mock_code" not in res


def test_code_stored_only_as_digest():
    svc, _ = _service()
    svc.generate_sms_otp(PHONE)
    stored = svc.otp_store.get(f"otp:code:{PHONE}")
    assert stored and svc.sent[-1] not in stored and len(stored) == 64


def test_correct_code_is_single_use():
    svc, _ = _service()
    svc.generate_sms_otp(PHONE)
    code = svc.sent[-1]
    assert svc.verify_sms_otp(PHONE, code)["authenticated"] is True
    again = svc.verify_sms_otp(PHONE, code)
    assert again == {"authenticated": False, "error": uas.OTP_GENERIC_ERROR}


def test_fifth_wrong_attempt_invalidates_code():
    svc, _ = _service()
    svc.generate_sms_otp(PHONE)
    code = svc.sent[-1]
    wrong = f"{(int(code) + 1) % 10**6:06d}"
    for _ in range(4):
        assert svc.verify_sms_otp(PHONE, wrong)["authenticated"] is False
    assert svc.verify_sms_otp(PHONE, code)["authenticated"] is True

    svc.generate_sms_otp(PHONE)
    code = svc.sent[-1]
    wrong = f"{(int(code) + 1) % 10**6:06d}"
    for _ in range(5):
        svc.verify_sms_otp(PHONE, wrong)
    assert svc.verify_sms_otp(PHONE, code)["authenticated"] is False


def test_expired_code_rejected():
    svc, clock = _service()
    svc.generate_sms_otp(PHONE)
    clock.now += uas.OTP_TTL_SECONDS + 1
    assert svc.verify_sms_otp(PHONE, svc.sent[-1])["authenticated"] is False


def test_send_limit_per_phone():
    svc, clock = _service()
    for _ in range(uas.OTP_SENDS_PER_PHONE):
        assert svc.generate_sms_otp(PHONE)["status"] == "OTP_DISPATCHED"
    blocked = svc.generate_sms_otp(PHONE)
    assert blocked == {"status": "OTP_REJECTED", "error": uas.OTP_GENERIC_ERROR}
    assert len(svc.sent) == uas.OTP_SENDS_PER_PHONE
    clock.now += uas.OTP_PHONE_WINDOW_SECONDS + 1
    assert svc.generate_sms_otp(PHONE)["status"] == "OTP_DISPATCHED"


def test_send_limit_per_ip():
    svc, _ = _service()
    ip = "203.0.113.9"
    for i in range(uas.OTP_SENDS_PER_IP):
        assert svc.generate_sms_otp(f"0912000{i:04d}", source_ip=ip)["status"] == "OTP_DISPATCHED"
    blocked = svc.generate_sms_otp("09129999999", source_ip=ip)
    assert blocked["error"] == uas.OTP_GENERIC_ERROR
    other = svc.generate_sms_otp("09129999999", source_ip="203.0.113.10")
    assert other["status"] == "OTP_DISPATCHED"


def test_errors_are_generic():
    svc, _ = _service()
    unknown = svc.verify_sms_otp("09125555555", "123456")
    svc.generate_sms_otp(PHONE)
    wrong = svc.verify_sms_otp(PHONE, f"{(int(svc.sent[-1]) + 1) % 10**6:06d}")
    assert unknown == wrong == {"authenticated": False, "error": uas.OTP_GENERIC_ERROR}
