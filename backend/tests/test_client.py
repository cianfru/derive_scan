import httpx
import pytest

from derive.client import DeriveClient, DeriveRPCError


def _client(responses):
    seq = iter(responses)
    seen = []

    def handler(request):
        seen.append(request)
        r = next(seq)
        if isinstance(r, Exception):
            raise r
        return r

    return DeriveClient("https://x/", transport=httpx.MockTransport(handler), backoff=0), seen


async def test_result_returned():
    c, seen = _client([httpx.Response(200, json={"result": [1, 2]})])
    assert await c.public("get_time", {"a": 1}) == [1, 2]
    assert str(seen[0].url) == "https://x/public/get_time"


async def test_retries_rate_limit_http_and_transport_errors():
    c, seen = _client([
        httpx.Response(200, json={"error": {"code": -32000, "message": "Rate limit exceeded"}}),
        httpx.Response(503),
        httpx.ConnectError("boom"),
        httpx.Response(200, json={"result": "ok"}),
    ])
    assert await c.public("get_time") == "ok"
    assert len(seen) == 4 and c.errors == 3


async def test_non_retryable_error_raises_once():
    c, seen = _client([httpx.Response(200, json={"error": {"code": -32602, "message": "Invalid params"}})])
    with pytest.raises(DeriveRPCError) as e:
        await c.public("get_tickers")
    assert e.value.code == -32602 and len(seen) == 1


async def test_gives_up():
    c, seen = _client([httpx.Response(502)] * 10)
    c.retries = 2
    with pytest.raises(DeriveRPCError):
        await c.public("get_time")
    assert len(seen) == 3
