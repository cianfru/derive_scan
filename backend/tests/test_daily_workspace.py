import json
from datetime import datetime, timezone

import httpx
import pytest

from derive.backfill import supplemental_before
from derive.candles import CandleCache
from derive.history import parse_option
from publish_site import cohort_lean, traders_block, flow_block, build
from signal_once import backfill_short


@pytest.mark.asyncio
async def test_coinbase_history_is_price_only_and_discards_incomplete_weeks():
    # Two UTC weeks, one day absent in the first; a newer/future row must not leak in.
    start = 4 * 86400 + 7 * 86400 * 2900
    before = (start + 14 * 86400) * 1000
    daily = [[t, 90, 110, 100, 105, 999] for t in range(start, before // 1000, 86400) if t != start + 86400]
    daily += [[before // 1000, 90, 110, 100, 99999, 999]]
    def handler(request):
        assert request.url.path == '/products/VVV-USD/candles'
        assert request.url.params['granularity'] == '86400'
        return httpx.Response(200, json=daily)
    rows, source = await supplemental_before('VVV', '1w', before, 2, httpx.MockTransport(handler))
    assert source == 'coinbase VVV-USD spot'
    assert rows == [[(start + 7 * 86400) * 1000, 100, 110, 90, 105, '0.0']]
    # No arbitrary ticker inference or LIT/Litentry substitution.
    assert await supplemental_before('LIT', '1d', before, 700) == ([], None)


@pytest.mark.asyncio
async def test_hype_uses_verified_spot_product_and_closed_bars():
    end = 1000 * 86400000
    def handler(request):
        body = json.loads(request.content)
        assert body['req']['coin'] == '@107'
        return httpx.Response(200, json=[
            {'t': end-86400000, 'T': end-1, 'o':'1','h':'3','l':'1','c':'2','v':'100'},
            {'t': end, 'T':end+86400000-1,'o':'2','h':'4','l':'2','c':'4','v':'200'}])
    rows, source = await supplemental_before('HYPE', '1d', end, 700, httpx.MockTransport(handler))
    assert rows == [[end-86400000,'1','3','1','2','0.0']]
    assert source == 'hyperliquid HYPE/USDC spot'


@pytest.mark.asyncio
async def test_provider_failure_never_erases_existing_price_history(tmp_path):
    cache = CandleCache(tmp_path)
    cache.append('VVV','1d',[[1000000000,2,3,1,2,10]])
    cache.write_backfill('VVV','1d',[[913600000,1,2,1,2,0]])
    log = await backfill_short(cache,['VVV'],2000000000,transport=httpx.MockTransport(lambda _:httpx.Response(503)))
    assert cache.counts('VVV','1d') == (1,1)
    assert log['VVV:1d']['ok'] is False and log['VVV:1d']['errors']
    assert cache.load('VVV','1d')['close'].tolist() == [2,2]


def test_cohort_expiry_slices_keep_gross_exposure_and_coin_identity(tmp_path):
    now = datetime(2026,10,2,tzinfo=timezone.utc).timestamp()
    names=['HYPE-20261005-100-C','HYPE-20261127-100-P']
    # Offset wallets: net=2 contracts but gross=10. The put in >30d is short delta.
    insts={names[0]:[2,4,10],names[1]:[3,2,3]}
    chains={'HYPE':({'ts':now,'expiries':{str(parse_option(n)[1]):[[100,0,0,.5,.5,.6]] for n in names}},100,now)}
    soon=cohort_lean(insts,chains,now,7)
    later=cohort_lean(insts,chains,now,None,30)
    assert soon['positions']==4 and soon['net_delta_usd']==120 and soon['gross_delta_usd']==600
    assert later['positions']==2 and later['net_delta_usd']==-120 and later['score']==-1
    assert cohort_lean(insts,{},now)['score'] is None
    doc={'schema_version':2,'through':'2026-10-01','traders':[],'ranked_total':0,
         'cohort_counts':{'pnl':{'Money Printer':6}},'cohort_positions':{'pnl':{'Money Printer':{'HYPE':insts}}}}
    (tmp_path/'history').mkdir();(tmp_path/'history/traders.json').write_text(json.dumps(doc))
    site=tmp_path/'site';traders_block(tmp_path,site,chains,{},now)
    cohort=json.loads((site/'traders.json').read_text())['cohorts']['pnl'][0]
    assert cohort['name']=='Money Printer'
    assert set(cohort['coins'])=={'HYPE'} and 'Other' not in cohort['coins']
    assert cohort['windows']['7d']['total']==soon
    assert cohort['windows']['beyond30d']['total']==later


def test_flow_summary_is_not_limited_to_large_trade_sample(tmp_path):
    sides={'BTC':{'24h':{'call':{'buy_premium_usd':1234},'coverage':{'ready':False}}},'_coverage':{}}
    block=flow_block(tmp_path,1790960000,sides)
    assert block['large']==[]
    assert block['by_coin']['BTC']['call']['buy_premium_usd']==1234
    assert block['by_coin']['BTC']['coverage']['ready'] is False


def test_publisher_distinguishes_recovered_history_and_keeps_daily_prices(tmp_path):
    data, site = tmp_path / 'data', tmp_path / 'site'
    cache = CandleCache(data)
    cache.append('VVV', '1d', [[172800000, 100, 115, 95, 110, 50], [259200000, 110, 125, 105, 121, 70]])
    cache.write_backfill('VVV', '1d', [[86400000, 90, 105, 85, 100, 0]])
    saved = {'universe':['VVV-PERP'], 'timeframes':{'1d':{'rows':[
        {'symbol':'VVV-PERP','timeframe':'1d','data_status':'not enough data', 'history_bars':2, 'zscore':1.2}
    ]}}}
    (data / 'signals').mkdir()
    (data / 'signals/latest.json').write_text(json.dumps(saved))
    (data / 'signals/status.json').write_text(json.dumps({'backfill':{'VVV:1d':{'sources':['coinbase VVV-USD spot']}}}))
    build(data, site, 345600)
    coin = json.loads((site / 'coins/VVV.json').read_text())
    market = json.loads((site / 'markets.json').read_text())['coins'][0]
    assert coin['daily_history']['refresh_pending'] is True
    assert coin['daily_history']['available_bars'] == 3
    assert coin['latest']['1d']['data_status'] == 'history_updated'
    assert market['z_1d'] == 1.2 and market['chg_1d'] == pytest.approx(10)
    assert market['spark_1d'] == [100,110,121]
    assert market['spark_times_1d'] == [172800,259200,345600]
    assert coin['candles']['1d'][0][-1] == 0
    assert json.loads((data / 'signals/latest.json').read_text()) == saved
