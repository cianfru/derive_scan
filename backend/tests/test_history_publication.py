"""Historical publication preserves observations, missing intervals and old CSV schemas."""
import csv
import json
import pytest

from publish_site import option_metric_history, recorded_metrics, metric_history
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
