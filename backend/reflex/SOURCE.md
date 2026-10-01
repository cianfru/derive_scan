# Source of the copied Reflex code

Repository: cianfru/RCCE_Scanner
Commit: e45ed97d91fa1cca58533144233dc807a63f4e8f (1 October 2026)

Files below are byte-identical to that commit (path in Reflex: `backend/<path>`); `tests/test_reflex_copy.py` checks the hashes. `__init__.py` and `cto_policy.py` are Derive Scan's own (`cto_policy.py` stands in for Reflex's, which needs Reflex's research package; it returns Reflex's default baseline policy).

To update: copy the same files from a newer Reflex commit, update this file and the hashes, run the tests and the parity report.

```
b205e009f38dbc791af7c3f4221c8c0acb7bcf4e6f0cbe6b34589c23a6b16e67  agent_layer.py
e43c5a2ec53e2e4720397c2cdb8101c107e043b0378e1533b78f11ab2dd789c0  candle_snapshot.py
9241b7373c20b1db02c0392e72913180486bea5311667d7216d176180b9f0cee  confluence.py
915c8eea5be2091c673434a26d5eb1a432029c34e65509796375b46a35bdafb9  decision_pipeline.py
c45191a62f9400338e69bda397fd66b737bf1d65e53dd5de8a7971961d5fdb74  engines/__init__.py
f57317f251742aed2bd6134e5111ddcd2ed3e4fd82253804e04dedde54dea6cd  engines/exhaustion_engine.py
546ca64b05987d2bdded50dd474a122f340cb8d47d4b9efd356c367ed98d4c92  engines/heatmap_engine.py
50aea775e4410e902f601fab0c0ba0774afe337fe2beb3fd702f005ede03a8e1  engines/larsson_engine.py
0d514da5a2e91698e75f8944996cc00584920e5310416cb024ef4b99b5259f59  engines/positioning_engine.py
ed51cc10c9c3e6c87766c66bf77d5fea89183cafaddc02ab40810cb3839b0191  engines/rcce_engine.py
781080186cd2707c89d2d5b917d06dac829936ba01bbe54403df0100530a9be4  opportunities.py
eea2309f68d543858fc63324f7981363a1ec2d19802c5c431f560e2c138cb4aa  signal_synthesizer.py
```
