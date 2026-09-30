import { useIdentity } from "~/hooks/use-identity";
import { useBadgeHolder } from "~/hooks/use-badge-holder";
import { BadgeHolderMark } from "~/components/ui/Badge";
import { AddressAvatar } from "./Avatar";
import { cn } from "~/lib/utils";

/** Avatar + display name for an address; the name links to Blockscout. A badge
 * holder's avatar carries the ETHSecurity Badge mark on its corner; `badge`
 * says so when the caller already knows (a comment's roles). */
export default function Identity({
  address,
  size = 24,
  className,
  nameClassName,
  linked = true,
  badge,
}: {
  address: string;
  size?: number;
  className?: string;
  nameClassName?: string;
  linked?: boolean;
  badge?: boolean;
}) {
  const id = useIdentity(address);
  const holder = useBadgeHolder(address, badge);
  // The mark at about three quarters of the avatar, hanging off its corner.
  const mark = Math.round(size * 0.72);
  const NameTag = linked ? "a" : "span";
  return (
    <span className={cn("group/identity inline-flex items-center gap-1.5", className)}>
      <span
        className="relative flex-none"
        style={holder ? { marginRight: Math.round(mark * 0.35) } : undefined}
      >
        <AddressAvatar address={address} size={size} />
        {holder && (
          <BadgeHolderMark
            // Grows and glows while the identity is hovered, as in the top bar.
            className="absolute drop-shadow-[0_0_1px_rgba(0,0,0,.6)] group-hover/identity:drop-shadow-[0_0_5px_rgba(242,193,78,.85)] motion-safe:transition-[scale,filter] motion-safe:duration-300 motion-safe:ease-[cubic-bezier(.34,1.56,.64,1)] motion-safe:group-hover/identity:scale-125"
            style={{
              width: mark,
              height: mark,
              bottom: -Math.round(mark * 0.3),
              right: -Math.round(mark * 0.45),
            }}
          />
        )}
      </span>
      <NameTag
        className={cn(
          "font-inter-tight font-bold text-[14.5px] text-[#f2f6fa]",
          linked && "hover:text-dao-bright",
          nameClassName,
        )}
        href={linked ? `https://eth.blockscout.com/address/${address}` : undefined}
        target={linked ? "_blank" : undefined}
        rel={linked ? "noopener noreferrer" : undefined}
        title={linked ? `View ${address} on Blockscout` : address}
      >
        {id.name}
      </NameTag>
    </span>
  );
}
