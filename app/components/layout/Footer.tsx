import { Link } from "react-router";
import { CONTACT_EMAIL, CONTACT_MAILTO, SOCIAL_LINKS } from "~/data/site";

// Figma: two 12.5px muted lines (30px above, 46px below), then an 88px legal bar.
export default function Footer() {
  return (
    <>
      <footer className="mx-auto max-w-[1100px] px-6 pb-[46px] pt-[30px] text-center text-[12.5px] text-muted">
        <p className="my-1.5">
          TheDAO Security Fund · coordinating ecosystem funding for Ethereum security.
        </p>
        <p className="my-1.5">
          To back an initiative, email <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a>
          {" · "}
          <Link className="text-white/35" to="/donation-terms">Donation Terms</Link>
        </p>
      </footer>
      <div className="flex min-h-[88px] flex-wrap items-center justify-between gap-5 border-t border-white/[.08] bg-dao-blue-legal px-12 py-4 max-[620px]:justify-center max-[620px]:px-5 max-[620px]:text-center">
        <p className="m-0 text-[12.5px] text-soft">
          © 2025–{new Date().getFullYear()} TheDAO LLC. All rights reserved.
        </p>
        <div className="flex items-center gap-3">
          {[
            [SOCIAL_LINKS.paragraph, "/paragraph-icon.svg", "Paragraph"],
            [SOCIAL_LINKS.twitter, "/x-icon.svg", "X"],
            [SOCIAL_LINKS.farcaster, "/farcaster-icon.svg", "Farcaster"],
          ].map(([href, src, label]) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener"
              aria-label={`TheDAO on ${label}`}
              className="block leading-none opacity-90 transition-[opacity,transform] duration-150 hover:-translate-y-px hover:opacity-100"
            >
              <img src={src} alt={label} width={40} height={40} className="block h-10 w-10" />
            </a>
          ))}
        </div>
      </div>
    </>
  );
}
