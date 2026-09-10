export const SITE_NAME = "TheDAO Security Fund";
export const SITE_URL =
  (import.meta.env?.VITE_SITE_URL as string | undefined)?.replace(/\/+$/, "") ||
  "https://fund.thedao.fund";
export const SITE_PUNCHLINE = "Initiatives";
export const SITE_DESCRIPTION =
  "Ecosystem-funded Ethereum security initiatives. Browse open initiatives, donate by wallet or card, back initiatives with pledges that pay on completion.";
export const SITE_TWITTER_HANDLE = "@thedaofund";
export const SITE_OG_IMAGE = "/og-image.png";
export const SITE_LOGO = "/dao-logo.svg";

export const HOME_URL = "https://thedao.fund";
export const TRANSPARENCY_URL = "https://thedao.fund/transparency";
export const GRIFF_X = "https://x.com/griffgreen";
/** Pledges and backing go through the fund's inbox (Griff, Sep 2026). */
export const CONTACT_EMAIL = "info@thedao.fund";
export const CONTACT_MAILTO = "mailto:" + CONTACT_EMAIL;

export const SOCIAL_LINKS = {
  twitter: "https://x.com/thedaofund",
  paragraph: "https://paragraph.xyz/@thedao.fund",
  farcaster: "https://warpcast.com/thedaofund",
};
