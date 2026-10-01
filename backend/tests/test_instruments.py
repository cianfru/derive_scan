from derive.instruments import expiry_date, live_expiries, parse_option_name


def test_parse_option_name():
    o = parse_option_name("ETH-20261030-1500-C")
    assert (o.underlying, o.expiry_date, o.strike, o.kind) == ("ETH", "20261030", 1500.0, "C")
    assert parse_option_name("HYPE-20261030-42.5-P").strike == 42.5


def test_parse_rejects_non_options():
    for bad in ["ETH-PERP", "ETH-20261030-1500-X", "ETH-2026103-1500-C", "ETH-20261030-abc-C", "ETH-20261030-0-C", ""]:
        assert parse_option_name(bad) is None


def test_expiry_date_is_utc():
    assert expiry_date(1793347200) == "20261030"


def test_live_expiries_filters_inactive_and_past():
    inst = [
        {"is_active": True, "option_details": {"expiry": 200}},
        {"is_active": True, "option_details": {"expiry": 200}},
        {"is_active": True, "option_details": {"expiry": 300}},
        {"is_active": False, "option_details": {"expiry": 400}},
        {"is_active": True, "option_details": {"expiry": 50}},
        {"is_active": True, "option_details": None},
    ]
    assert live_expiries(inst, now=100) == [200, 300]
