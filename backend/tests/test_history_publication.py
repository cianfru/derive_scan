"""Historical publication preserves observations, missing intervals and old CSV schemas."""
import csv
import json
import pytest

from publish_site import fill_from_replay, option_metric_history, recorded_metrics, metric_history
from derive.candles import CandleCache
import signal_once


def write_csv(path, fields, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(fields)
        writer.writerows(rows)


def test_option_history_reports_real_start_and_gaps_without_filling(tmp_path):
    start = 1790812800
    path = tmp_path / 'v2_mainnet/BTC/features/2026-10-01.csv'
    fields = ['ts', 'feature', 'value']
    write_csv(path, fields, [[start, 'atm_iv_30d', '.5'], [start, 'index_price', '100'],
                            [start, 'perp_oi_contracts', '2'], [start, 'perp_basis', '.1'],
                            [start + 1800, 'index_price', '101'],
                            [start + 2700, 'atm_iv_30d', '.8'],
                            [start + 1800, 'rr25_30d', 'nan']])
    rows, coverage = option_metric_history(tmp_path, 'BTC', start + 1800)
    assert [r['ts'] for r in rows] == [start, start + 1800]
    assert rows[0]['perp_oi_usd'] == pytest.approx(220)
    assert rows[1]['atm_iv_30d'] is None
    assert rows[1]['rr25_30d'] is None
    assert rows[1]['perp_oi_usd'] is None
    assert coverage['history_available_from'] == start
    assert coverage['expected_count'] == 3 and coverage['missing_count'] == 1
    assert coverage['status'] == 'partial'
    assert 'cannot be recreated' in coverage['limitation']


def test_recorded_readings_win_and_warmup_does_not_become_a_signal(tmp_path, monkeypatch):
    import publish_site
    start = 1790812800
    path = tmp_path / 'signals/1d/2026-10-01.csv'
    fields = ['bar_close', 'symbol', 'signal', 'signal_status', 'data_status', 'regime', 'zscore', 'heat', 'ribbon', 'funding_rate']
    write_csv(path, fields, [[start, 'BTC-PERP', 'LIGHT_LONG', 'ready', 'ready', 'MARKUP', '1.4', '20', 'gold', '.00001'],
                            [start + 86400, 'NEW-PERP', 'WAIT', 'ready', 'warming up', 'FLAT', '0', '0', 'grey', '']])
    data = recorded_metrics(tmp_path, start + 86400)
    assert data['BTC']['1d'][start]['funding_ann'] == pytest.approx(.0876)
    assert data['BTC']['1d'][start]['oi_usd'] is None
    assert data['NEW']['1d'][start + 86400]['signal'] is None
    assert data['NEW']['1d'][start + 86400]['zscore'] is None
    monkeypatch.setattr(publish_site, 'build_engine_history', lambda *args, **kwargs: {
        'rows': [{'ts': start - 86400, 'source': 'reconstructed', 'signal': None, 'zscore': 1.0},
                 {'ts': start, 'source': 'reconstructed', 'signal': None, 'zscore': -99}], 'coverage': {}})
    result = metric_history(tmp_path, CandleCache(tmp_path), 'BTC', start + 86400, data['BTC'])
    daily = result['engine']['1d']
    assert daily[-1]['signal'] == 'LIGHT_LONG' and daily[-1]['zscore'] == 1.4
    assert daily[-2]['signal'] is None
    assert result['coverage']['engine']['1d']['recorded_count'] == 1
    assert result['coverage']['engine']['1d']['reconstructed_count'] == 1


def test_signal_csv_schema_upgrade_preserves_original_values(tmp_path):
    path = tmp_path / 'signals/1d/2026-10-03.csv'
    old_fields = signal_once.CSV_FIELDS[:-5]
    old = {key: '' for key in old_fields}
    old.update(bar_close='100', symbol='BTC-PERP', signal='WAIT', zscore='1.234', funding_rate='.00001')
    write_csv(path, old_fields, [[old[k] for k in old_fields]])
    row = {'signal_bar_close_time': 200, 'symbol': 'BTC-PERP', 'signal': 'LIGHT_LONG',
           'positioning': {'oi_value': 1234, 'oi_contracts': 12, 'observed_at': 210}}
    signal_once.append_csv(path, [signal_once._csv_row(row)])
    with path.open() as f:
        result = list(csv.DictReader(f))
    assert len(result) == 2
    assert result[0]['signal'] == 'WAIT' and result[0]['zscore'] == '1.234'
    assert result[0]['oi_usd'] == '' and result[0]['positioning_at'] == ''
    assert result[1]['oi_usd'] == '1234' and result[1]['positioning_at'] == '210'


def test_legacy_default_heat_and_warmup_ribbon_are_unknown_until_validity_is_known(tmp_path):
    start = 1790812800
    path = tmp_path / 'signals/1d/2026-10-01.csv'
    fields = ['bar_close', 'symbol', 'signal_status', 'data_status', 'heat', 'ribbon', 'heat_valid', 'ribbon_quality']
    write_csv(path, fields, [[start, 'BTC-PERP', 'ready', 'ready', '0', 'gold', '', ''],
                            [start + 86400, 'BTC-PERP', 'ready', 'ready', '0', 'gold', '1', 'ready'],
                            [start + 2*86400, 'BTC-PERP', 'ready', 'ready', '0', 'blue', '0', 'warmup']])
    rows = recorded_metrics(tmp_path, start + 2*86400)['BTC']['1d']
    assert rows[start]['heat'] is None and rows[start]['ribbon'] is None
    assert rows[start + 86400]['heat'] == 0 and rows[start + 86400]['ribbon'] == 'gold'
    assert rows[start + 2*86400]['heat'] is None and rows[start + 2*86400]['ribbon'] is None

    latest = {'timeframes': {'1d': {'rows': [{'symbol': 'BTC-PERP', 'signal_bar_close_time': start,
                                           'bmsb_valid': True, 'ribbon': {'data_quality': 'ready'}}]}}}
    (tmp_path / 'signals/latest.json').write_text(json.dumps(latest))
    enriched = recorded_metrics(tmp_path, start + 2*86400)['BTC']['1d'][start]
    assert enriched['heat'] == 0 and enriched['ribbon'] == 'gold'


READY = {k: "ready" for k in ("regime", "zscore", "heat", "ribbon")}


def _replayed(ts, **values):
    return {"ts": ts, "source": "reconstructed", "status": "ready", "signal": None, "unified_signal": None,
            "funding_ann": None, "oi_usd": None, "metric_status": dict(READY), **values}


def test_ready_replay_fills_price_metrics_of_a_close_saved_while_warming_up(tmp_path, monkeypatch):
    import publish_site
    start = 1790812800
    fields = ['bar_close', 'symbol', 'signal', 'signal_status', 'data_status', 'regime', 'zscore', 'heat',
              'ribbon', 'funding_rate', 'heat_valid', 'ribbon_quality']
    write_csv(tmp_path / 'signals/1d/2026-10-01.csv', fields, [
        [start, 'HYPE-PERP', 'WAIT', 'ready', 'warming up', 'REACC', '-0.4', '30', 'gold', '.00001', '1', 'warmup'],
        [start + 86400, 'HYPE-PERP', 'ACCUMULATE', 'ready', 'ready', 'REACC', '-1.36', '28', 'gold', '.00001', '1', 'ready']])
    saved = recorded_metrics(tmp_path, start + 86400)['HYPE']
    calls = []

    def replay(*args, **kwargs):
        calls.append({int(r['ts']) for r in kwargs['recorded_rows']})
        return {'coverage': {}, 'rows': [
            _replayed(start - 86400, regime='MARKUP', zscore=.5, heat=10, heat_phase='Neutral', ribbon='gold'),
            _replayed(start, regime='REACC', zscore=-1.22, heat=29.0, heat_phase='Extension', ribbon='gold'),
            # a replay row at a close saved as ready never replaces it
            _replayed(start + 86400, regime='MARKDOWN', zscore=-99, heat=99, heat_phase='Entry', ribbon='blue')]}

    monkeypatch.setattr(publish_site, 'build_engine_history', replay)
    result = metric_history(tmp_path, CandleCache(tmp_path), 'HYPE', start + 86400, saved)
    assert calls[0] == {start + 86400}  # the warming-up close is replayed, the ready one is not
    rows = {r['ts']: r for r in result['engine']['1d']}
    filled = rows[start]
    assert filled['zscore'] == -1.22 and filled['regime'] == 'REACC' and filled['ribbon'] == 'gold'
    assert filled['filled_from_replay'] == ['regime', 'zscore', 'ribbon']
    assert filled['heat'] == 30 and 'heat_phase' not in filled  # a saved value is kept
    assert filled['signal'] is None and filled['funding_ann'] == pytest.approx(.0876)
    assert filled['source'] == 'recorded' and filled['status'] == 'warming up'
    assert filled['metric_status'] == READY
    ready = rows[start + 86400]
    assert ready['zscore'] == -1.36 and ready['signal'] == 'ACCUMULATE' and ready['regime'] == 'REACC'
    assert ready['heat'] == 28 and ready['ribbon'] == 'gold' and 'filled_from_replay' not in ready
    assert rows[start - 86400]['source'] == 'reconstructed'
    coverage = result['coverage']['engine']['1d']
    assert coverage['recorded_count'] == 2 and coverage['reconstructed_count'] == 1
    assert coverage['filled_from_replay_count'] == 1 and coverage['samples'] == 1
    assert 'options' not in result and set(result['coverage']) == {'engine', 'options'}


def test_fill_copies_only_ready_price_metrics():
    saved = {'ts': 1, 'source': 'recorded', 'status': 'not enough data', 'signal': None, 'regime': None,
             'zscore': None, 'heat': None, 'ribbon': None, 'funding_ann': None, 'oi_usd': None,
             'metric_status': {'regime': 'not enough data', 'zscore': 'not enough data', 'heat': 'unavailable', 'ribbon': 'unknown'}}
    replay = _replayed(1, regime='MARKUP', zscore=1.1, heat=8.0, heat_phase='Neutral', ribbon=None,
                       signal='LIGHT_LONG', funding_ann=.1, oi_usd=5.0, atm_iv_30d=.5)
    replay['metric_status']['ribbon'] = 'warmup'
    out = fill_from_replay(saved, replay)
    assert out['filled_from_replay'] == ['regime', 'zscore', 'heat', 'heat_phase']
    assert (out['regime'], out['zscore'], out['heat'], out['heat_phase']) == ('MARKUP', 1.1, 8.0, 'Neutral')
    assert out['ribbon'] is None and out['metric_status']['ribbon'] == 'unknown'
    assert out['signal'] is None and out['funding_ann'] is None and out['oi_usd'] is None and 'atm_iv_30d' not in out
    assert saved['regime'] is None and 'filled_from_replay' not in saved  # the saved row is not mutated
    assert fill_from_replay(dict(saved, status='ready'), replay)['regime'] is None
    assert fill_from_replay(saved, None) is saved
    unready = _replayed(1, regime='MARKUP', zscore=1.1, heat=8.0, heat_phase='Neutral', ribbon='gold')
    unready['metric_status'] = {k: 'warming up' for k in READY}
    assert 'filled_from_replay' not in fill_from_replay(saved, unready)
