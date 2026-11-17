import { useIdentity } from "~/hooks/use-identity";

export function Avatar(
  { src, size = 26, className = "" }: { src: string; size?: number; className?: string },
) {
  return (
    <img
      className={`pfp ${className}`}
      src={src}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size }}
    />
  );
}

/** Avatar resolved from the address's profile (nickname/pfp lookups cached). */
export function AddressAvatar(
  { address, size = 26, className }: { address: string; size?: number; className?: string },
) {
  const id = useIdentity(address);
  return <Avatar src={id.avatar} size={size} className={className} />;
}
