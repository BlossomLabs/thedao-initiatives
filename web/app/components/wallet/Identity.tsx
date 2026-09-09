import { useState } from "react";
import { useIdentity } from "~/hooks/use-identity";
import { AddressAvatar } from "./Avatar";
import { cn } from "~/lib/utils";

/** Avatar + display name for an address; click the name to reveal the address. */
export default function Identity({
  address,
  size = 24,
  className,
  nameClassName,
  revealable = true,
}: {
  address: string;
  size?: number;
  className?: string;
  nameClassName?: string;
  revealable?: boolean;
}) {
  const id = useIdentity(address);
  const [shown, setShown] = useState(false);
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <AddressAvatar address={address} size={size} />
      <span
        className={cn(
          "font-inter-tight font-bold text-[14.5px] text-[#f2f6fa]",
          revealable && "cursor-pointer hover:text-dao-bright",
          nameClassName,
        )}
        title={revealable ? "Click to show address" : address}
        onClick={revealable ? () => setShown((s) => !s) : undefined}
      >
        {id.name}
      </span>
      {shown && <span className="mono text-[12px] text-muted">{address}</span>}
    </span>
  );
}
