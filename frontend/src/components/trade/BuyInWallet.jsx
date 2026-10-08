import { useEffect, useId, useRef, useState } from "react";
import { Arrow, Info } from "../ui.jsx";
import "../../buy-in-wallet.css";

export const WALLET_BUY_GUIDES = [
  { rdns: "io.metamask", name: "MetaMask", url: "https://support.metamask.io/manage-crypto/move-crypto/buy/how-to-buy-crypto-in-metamask/" },
  { rdns: "com.coinbase.wallet", name: "Coinbase Wallet", url: "https://help.coinbase.com/en/wallet/managing-account/buy-crypto" },
];

// EIP-6963 announcements must refer to the connected provider. Legacy isMetaMask alone does not
// identify a wallet: other wallets also set it. Unknown identities keep the generic instructions.
function useBuyWallet(provider, open) {
  const [announced, setAnnounced] = useState(null);
  useEffect(() => {
    if (!open || !provider || typeof window === "undefined") return undefined;
    const identify = ({ detail }) => {
      if (detail?.provider !== provider) return;
      const wallet = WALLET_BUY_GUIDES.find(({ rdns }) => rdns === detail.info?.rdns);
      setAnnounced(wallet ? { provider, wallet } : null);
    };
    window.addEventListener("eip6963:announceProvider", identify);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", identify);
  }, [provider, open]);
  return announced && announced.provider === provider ? announced.wallet : null;
}

/** Mainnet funding guidance only; its caller decides when real-money funding is available. */
export default function BuyInWallet({ provider, networkName = "Ethereum", disabled = false }) {
  const [open, setOpen] = useState(false);
  const id = useId(), trigger = useRef(null);
  const wallet = useBuyWallet(provider, open);
  const guides = wallet ? [wallet] : WALLET_BUY_GUIDES;
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <div className="buy-wallet">
      <button type="button" ref={trigger} className="buy-wallet-trigger" disabled={disabled}
        aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>
        <span><small>No crypto yet?</small><b>Buy with Apple Pay in your wallet</b></span>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d={open ? "m3 9 4-4 4 4" : "m3 5 4 4 4-4"} fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
      {open && <section className="buy-wallet-panel" id={id} aria-labelledby={`${id}-title`}>
        <h3 id={`${id}-title`}>Buy in {wallet?.name || "your wallet"}</h3>
        <ol className="buy-wallet-steps">
          <li><b>Open {wallet?.name || "your wallet"}.</b><span>Choose Buy.</span></li>
          <li><b>Choose USDC on {networkName}.</b><span>Select Apple Pay if it is offered.</span></li>
          <li><b>Come back to Cowboy.</b><span>Continue funding your Derive account.</span></li>
        </ol>
        <p className="buy-wallet-note">Availability depends on your wallet and location.
          <Info label="Apple Pay fees and availability">Your wallet’s payment provider sets the purchase fee and may ask for an identity check. Apple Pay, USDC and network availability vary by provider and location. Review the quote in your wallet before paying. Buying USDC adds it to your wallet; moving it into Derive is a separate step, with any network fee shown before you confirm.</Info>
        </p>
        <div className="buy-wallet-guides" aria-label="Official wallet guides">
          {guides.map((guide) => <a key={guide.rdns} className="text-link" href={guide.url} target="_blank" rel="noopener noreferrer">{guide.name} guide<Arrow /></a>)}
        </div>
        <button type="button" className="text-control buy-wallet-close" onClick={close}>Back to funding</button>
      </section>}
    </div>
  );
}
