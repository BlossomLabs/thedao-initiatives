/** Form styles shared by the comment composer and the reply box. */

/** Name field for a post without a wallet. */
export const nameInput =
  "h-[38px] w-full max-w-[360px] rounded-[10px] border border-white/10 bg-[rgba(9,18,30,.5)] px-3.5 font-inter-tight text-[14px] text-white outline-none placeholder:text-muted focus:border-[rgba(92,183,90,.55)] disabled:cursor-default disabled:opacity-60";

/** Green submit button (Comment, Post reply). */
export const submitBtn =
  "inline-flex h-[38px] cursor-pointer items-center gap-[7px] rounded-[10px] border border-dao-green bg-dao-green px-5 font-inter-tight text-[13px] font-bold text-[#0d1f14] transition-all duration-150 active:scale-[.97] hover:border-[#6cc96a] hover:bg-[#6cc96a] hover:shadow-[0_0_16px_rgba(0,255,136,.28)] disabled:cursor-default disabled:opacity-60 disabled:shadow-none disabled:active:scale-100";

/** Muted "Signed in as …" line next to a submit button. */
export const signedInAs =
  "inline-flex items-center gap-[7px] font-inter-tight text-[13px] text-muted";
