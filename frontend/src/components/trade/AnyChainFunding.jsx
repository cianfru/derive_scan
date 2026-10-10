import { useEffect, useId, useRef, useState } from "react";
import { Info } from "../ui.jsx";
import { money } from "../../lib/questions.js";
import { NETWORK } from "../../lib/trade/config.js";
import { fundingChains, fundingHoldings, fundingQuote } from "../../lib/trade/anychain.js";
import { bridgeDeposit, dismissRefundedBridge, refreshBridge, retryBridgeRegistration, useSeat } from "../../lib/trade/seat.js";
import "../../funding.css";

const usd = (v) => Number.isFinite(v) ? money(v, { cents: true }) : "Unavailable";
const duration = (seconds) => seconds < 60 ? `About ${Math.ceil(seconds)} seconds` : `About ${Math.ceil(seconds / 60)} minutes`;
const native = (token) => /^0x0{40}$/i.test(token?.address || "");
const reason = (error) => typeof error === "string" ? error : error?.detail?.message || error?.reason || error?.message || "The route provider could not answer. Try again shortly.";
const BUSY = { checking: "Checking route…", sign_in: "Confirm sign-in in your wallet…", switching: "Switch network in your wallet…", approving: "Approve the token in your wallet…", approval_pending: "Waiting for token approval…", sending: "Confirm transfer in your wallet…", registering: "Tracking your deposit…" };
const EXPLORERS = { 1: "https://etherscan.io", 8453: "https://basescan.org", 42161: "https://arbiscan.io", 999: "https://hyperevmscan.io" };

function RouteFailure({ error }) {
  return <p className="tr-msg" role="status">No route right now<Info label="Why no route is available">{reason(error)}</Info></p>;
}

/** Loaded with the trade panel only, and discarded entirely when FUND_ANYCHAIN is off. */
export default function AnyChainFunding() {
  const seat = useSeat(), id = useId();
  const [walletAssets, setWalletAssets] = useState({ loading: true, chains: [], tokens: {}, error: null });
  const [reload, setReload] = useState(0);
  const [expandedScan, setExpandedScan] = useState(false);
  const [chainId, setChainId] = useState(8453), [tokenAddress, setTokenAddress] = useState("");
  const [amount, setAmount] = useState(""), [request, setRequest] = useState({});
  const quoteRead = useRef(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!NETWORK.real || !seat.wallet) return;
    const controller = new AbortController();
    setWalletAssets({ loading: true, chains: [], tokens: {}, error: null });
    (async () => {
      const available = (await fundingChains({ signal: controller.signal })).filter((c) => c.balanceAvailable);
      const responses = await Promise.allSettled(available.map((c) => fundingHoldings(seat.wallet, c, { signal: controller.signal, expanded: expandedScan })));
      if (controller.signal.aborted) return;
      const tokens = {}, failures = [];
      available.forEach((c, i) => {
        const r = responses[i];
        if (r.status === "fulfilled") {
          tokens[c.id] = r.value.filter((t) => /^\d+$/.test(t.balance) && BigInt(t.balance) > 0n);
          if (r.value.unavailable) failures.push(c.name);
        } else failures.push(c.name);
      });
      const chains = available.filter((c) => tokens[c.id]?.length);
      const first = chains.find((c) => c.id === 8453) || chains[0];
      setChainId(first?.id || 8453);
      const firstTokens = tokens[first?.id] || [];
      setTokenAddress((firstTokens.find((t) => t.symbol === "USDC") || firstTokens[0])?.address || "");
      setWalletAssets({ loading: false, chains, tokens, error: null, failures });
    })().catch((error) => { if (!controller.signal.aborted) setWalletAssets({ loading: false, chains: [], tokens: {}, error }); });
    return () => controller.abort();
  }, [seat.wallet, reload, expandedScan]);
  const chain = walletAssets.chains.find((c) => c.id === chainId);
  const tokens = walletAssets.tokens[chainId] || [];
  const token = tokens.find((t) => t.address.toLowerCase() === tokenAddress.toLowerCase());
  const key = [seat.wallet, seat.depositAddress, chainId, tokenAddress, amount].join(":");
  useEffect(() => () => quoteRead.current?.abort(), [key]);
  const quote = request.key === key ? request.quote : null;
  const pending = request.key === key && request.pending;
  const error = request.key === key && request.error;
  const expired = quote && now >= (quote.expiresAt || quote.createdAt + 60_000);
  const canQuote = !!(chain && token && Number(amount) > 0 && seat.depositAddress && !seat.busy && !pending);
  useEffect(() => {
    if (!quote) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [quote]);
  useEffect(() => { setRequest({}); }, [seat.wallet, seat.depositAddress]);
  const getQuote = async () => {
    if (!canQuote) return;
    quoteRead.current?.abort();
    const controller = new AbortController(); quoteRead.current = controller;
    setRequest({ key, pending: true });
    try {
      const value = await fundingQuote({ client: seat.client, wallet: seat.wallet, depositAddress: seat.depositAddress, chain, token, amount, signal: controller.signal });
      if (!controller.signal.aborted) setRequest({ key, quote: value });
    } catch (failure) { if (!controller.signal.aborted) setRequest({ key, error: failure }); }
  };
  const selectChain = (value) => {
    setChainId(Number(value)); setAmount(""); setRequest({});
    const options = walletAssets.tokens[value] || [];
    setTokenAddress((options.find((t) => t.symbol === "USDC") || options[0])?.address || "");
  };
  if (!NETWORK.real) return <p className="tr-note">Cross-chain funding uses real funds on mainnet. This build uses test USDC.</p>;
  return <section className="fund-anychain" aria-label="Pay from another chain">
    <p className="tr-note">Use crypto in your connected wallet. It arrives as USDC in your Derive account.<Info label="Supported funding wallets">EVM wallets are supported first. Solana wallet funding is planned separately. Routes use your own registered Derive deposit address; Cowboy does not hold the funds.</Info></p>
    {walletAssets.loading ? <p className="tr-note" role="status">{expandedScan ? "Checking other supported tokens. This can take a little longer…" : "Finding common assets in your wallet…"}</p> : walletAssets.error ? <>
      <RouteFailure error={walletAssets.error} /><button type="button" className="text-control" onClick={() => setReload((n) => n + 1)}>Check wallet again</button>
    </> : !chain ? <>
      <p className="tr-note">No available tokens found on the supported chains.</p>
      {!!walletAssets.failures?.length && <p className="tr-note">Some balances are unavailable<Info label="About missing wallet balances">Could not check every token on {walletAssets.failures.join(", ")}. Unavailable balances are not treated as zero.</Info></p>}
      <button type="button" className="text-control" onClick={() => setReload((n) => n + 1)}>Check wallet again</button>
      {!expandedScan && <button type="button" className="text-control" onClick={() => setExpandedScan(true)}>Find other tokens</button>}
    </> : <>
      <div className="fund-pickers">
        <label htmlFor={`${id}-chain`}>From chain<select id={`${id}-chain`} value={chainId} disabled={seat.busy} onChange={(e) => selectChain(e.target.value)}>{walletAssets.chains.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label htmlFor={`${id}-token`}>Pay with<select id={`${id}-token`} value={tokenAddress} disabled={seat.busy} onChange={(e) => { setTokenAddress(e.target.value); setAmount(""); setRequest({}); }}>{tokens.map((t) => <option key={t.address} value={t.address}>{t.symbol}</option>)}</select></label>
      </div>
      <label className="fund-amount" htmlFor={`${id}-amount`}><span>Amount in {token?.symbol}</span><input id={`${id}-amount`} inputMode="decimal" autoComplete="off" placeholder="0.00" value={amount} disabled={seat.busy} onChange={(e) => { if (/^\d*(\.\d*)?$/.test(e.target.value)) setAmount(e.target.value); }} /></label>
      <p className="tr-note">Available: {token?.formattedBalance} {token?.symbol}{!!walletAssets.failures?.length && <Info label="About wallet balance coverage">Some token balances on {walletAssets.failures.join(", ")} could not be checked. Only balances successfully read are listed.</Info>}</p>
      {!expandedScan && <p className="fund-more tr-note">Common supported assets<button type="button" className="text-control" disabled={seat.busy} onClick={() => { setRequest({}); setExpandedScan(true); }}>Find other tokens</button></p>}
      {error && <RouteFailure error={error} />}
      {!quote ? <button type="button" className="btn primary fund-go" onClick={getQuote} disabled={!canQuote}>{pending ? "Finding a fast route…" : "See route and cost"}</button> : <>
        <div className="fund-quote" aria-label="Funding quote">
          <p className="fund-arrival"><span>USDC arriving</span><b className="mono">{usd(quote.arrivesUsd)}</b><small>At least {usd(quote.minArrivesUsd)} after route fees</small></p>
          <dl className="tr-figs">
            <div><dt>Estimated total cost<Info label="About funding costs">Includes the bridge, swaps and estimated source-chain gas, including token approval when needed. Your wallet shows its final network fee before confirmation. Cowboy adds no fee. Derive credits the arriving USDC under its deposit rules.</Info></dt><dd className="mono">{usd(quote.costUsd)}</dd></div>
            {quote.approvalRequired && <div><dt>Approval gas, included</dt><dd className="mono">{quote.approvalGasUsd < 0.01 ? "Less than $0.01" : usd(quote.approvalGasUsd)}</dd></div>}
            <div><dt>Bridge estimate</dt><dd>{duration(quote.seconds)}</dd></div>
            <div><dt>Derive account credit</dt><dd>Usually 1–2 minutes</dd></div>
          </dl>
          <p className="tr-note">Minimum arrival: {usd(quote.minDepositUsd + quote.safetyUsd)}<Info label="Why the deposit minimum matters">Derive's current USDC minimum is {usd(quote.minDepositUsd)}. Cowboy adds a {usd(quote.safetyUsd)} margin and checks the route's minimum arrival after fees. A deposit below Derive's minimum is not credited to your account.</Info></p>
        </div>
        <p className="tr-note">{native(token) ? "Confirm the transfer once in your wallet." : "Your wallet may ask for token approval first, then one transfer confirmation."} {seat.newAccount || seat.loggedAs !== "owner" ? "A sign-in message may be needed before the transfer." : ""}</p>
        {expired && <p className="tr-msg" role="status">This quote has expired. Check the route again.</p>}
        <button type="button" className="btn primary fund-go" disabled={seat.busy || expired || !Number.isFinite(quote.costUsd)} onClick={() => bridgeDeposit(quote)}>{seat.busy ? BUSY[seat.bridge?.phase] || "Check your wallet…" : `Send ${amount} ${token.symbol}`}</button>
        <button type="button" className="text-control" disabled={seat.busy || pending} onClick={getQuote}>Refresh route</button>
      </>}
    </>}
  </section>;
}

/** The countdown is an estimate, never a claim that funds have arrived. Polls are read-only. */
export function BridgeProgress() {
  const seat = useSeat(), bridge = seat.bridge;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!bridge?.txHash) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => { refreshBridge(); }, 5000);
    return () => { clearInterval(timer); clearInterval(poll); };
  }, [bridge?.txHash]);
  if (!bridge?.txHash) return null;
  const elapsed = Math.max(0, Math.floor((now - bridge.startedAt) / 1000));
  const remaining = Math.max(0, Math.ceil((bridge.quote?.seconds || 0) - elapsed));
  const delivered = bridge.phase === "delivered";
  const failed = bridge.phase === "failed" || bridge.phase === "attention";
  const explorer = EXPLORERS[bridge.quote?.request?.fromChain];
  return <div className="fund-progress" aria-label="Deposit progress">
    <ol aria-label="Funding steps"><li className="complete">Sent from wallet</li><li className={delivered ? "complete" : ""}>Bridge delivery</li><li>Derive credit</li></ol>
    <p className="fund-countdown">{failed ? "The route needs attention" : delivered ? "USDC delivered. Waiting for Derive." : remaining > 0 ? <>Bridge estimate <b className="mono">{remaining}s</b></> : "Taking longer than estimated. Checking delivery…"}</p>
    <p className="tr-note">{failed ? bridge.status?.notice || "Check the transfer before trying another deposit." : delivered ? "Derive usually credits USDC within 1–2 minutes. Check again to see your balance." : "The bridge estimate covers delivery to Ethereum. Derive credits your account afterwards."}</p>
    {bridge.statusError && <p className="tr-note">Delivery status unavailable<Info label="About the delivery status">{reason(bridge.statusError)} Your transfer has already been sent; checking its status never sends another one.</Info></p>}
    {bridge.registrationError && <p className="tr-note">Your transfer was sent. Derive's tracking has not updated yet.<Info label="About deposit tracking">{reason(bridge.registrationError)} Retrying tracking never sends another transfer.</Info><button type="button" className="text-control" disabled={seat.busy} onClick={retryBridgeRegistration}>Retry tracking</button></p>}
    {bridge.safeToRetry && <div className="tr-actions"><button type="button" className="text-control" disabled={seat.busy} onClick={dismissRefundedBridge}>{seat.busy ? "Checking returned funds…" : "Choose another funding route"}</button><Info label="Why another route is available">The source transfer was reverted or its refund was verified on the source chain. Cowboy checks your available balance again before reopening funding. This does not send a transfer.</Info></div>}
    <details className="fund-receipt"><summary>Transfer details</summary><p className="mono">{bridge.txHash}</p>{explorer && <a className="text-link" href={`${explorer}/tx/${bridge.txHash}`} target="_blank" rel="noopener noreferrer">View source transfer</a>}</details>
  </div>;
}
