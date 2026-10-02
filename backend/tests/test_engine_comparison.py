from copy import deepcopy
from derive.signals import engine_comparison


def row(tf, signal='LIGHT_LONG', regime='MARKUP'):
    return dict(timeframe=tf, signal_status='ready', data_status='ready',
                signal_bar_close_time=100000, signal=signal, regime=regime,
                heat=20, entry_blocked=False,
                confluence={'score': 0, 'signal_4h': 'WAIT'}, unified_signal='WAIT')


def test_comparison_uses_final_decisions_without_mutating_saved_state():
    four, daily = row('4h','STRONG_LONG'), row('1d')
    before = deepcopy([four,daily])
    result = engine_comparison(four,daily,100100)
    assert result['confluence']['signal_4h'] == 'STRONG_LONG'
    assert result['confluence']['signal_1d'] == 'LIGHT_LONG'
    assert result['confluence']['score'] == 100
    assert result['unified'] == 'LIGHT_LONG'
    assert [four,daily] == before


def test_incomplete_and_stale_pairs_cannot_report_current_agreement():
    four,daily = row('4h'),row('1d')
    for r in [None, {**four,'data_status':'warming up'}, {**four,'engine_errors':['failure']},
              {**four,'signal_bar_close_time':80000}]:
        result=engine_comparison(r,daily,100100)
        assert result['confluence'] is None
        assert result['unified'] is None
    assert engine_comparison(four,daily,99999)['confluence'] is None


def test_combined_exit_overrides_a_long_setup_without_claiming_agreement():
    result=engine_comparison(row('4h','TRIM','BLOWOFF'),row('1d'),100100)
    assert result['unified']=='TRIM'
    assert result['confluence']['signal_aligned'] is False
    assert result['confluence']['regime_aligned'] is False
