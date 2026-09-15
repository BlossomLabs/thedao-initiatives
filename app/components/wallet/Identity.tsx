import { useIdentity } from "~/hooks/use-identity";
import { AddressAvatar } from "./Avatar";
import { cn } from "~/lib/utils";

/** Avatar + display name for an address; the name links to Blockscout. */
export default function Identity({
  address,
  size = 24,
  className,
  nameClassName,
  linked = true,
}: {
  address: string;
  size?: number;
  className?: string;
  nameClassName?: string;
  linked?: boolean;
}) {
  const id = useIdentity(address);
  const NameTag = linked ? "a" : "span";
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <AddressAvatar address={address} size={size} />
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
