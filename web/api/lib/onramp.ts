import type { Config } from "../config.ts";

/** Card-checkout URL template ("{AMT}" = dollar amount) delivering USDC to a Safe. */
export function onrampLink(
  config: Config,
  safeAddress: string,
): { url: string; prefilled: boolean } {
  const { onrampProvider: p, onrampApiKey: key } = config;
  if (p === "transak" && key) {
    return {
      url: `https://global.transak.com/?apiKey=${
        encodeURIComponent(key)
      }&cryptoCurrencyCode=USDC&network=ethereum&fiatCurrency=USD&defaultFiatAmount={AMT}&walletAddress=${safeAddress}`,
      prefilled: true,
    };
  }
  if (p === "moonpay" && key) {
    return {
      url: `https://buy.moonpay.com/?apiKey=${
        encodeURIComponent(key)
      }&currencyCode=usdc&baseCurrencyCode=usd&baseCurrencyAmount={AMT}&walletAddress=${safeAddress}`,
      prefilled: true,
    };
  }
  return { url: "", prefilled: false };
}
