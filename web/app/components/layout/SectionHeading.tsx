export default function SectionHeading({
  children,
  count,
  id,
}: {
  children: React.ReactNode;
  count?: number | string;
  id?: string;
}) {
  return (
    <h2 id={id} className="h2">
      {children}
      {count !== undefined && count !== "" && <span className="n">({count})</span>}
    </h2>
  );
}
