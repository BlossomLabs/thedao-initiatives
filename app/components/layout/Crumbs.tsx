import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "~/components/ui/Breadcrumb";

export interface Crumb {
  label: string;
  /** Where the crumb leads; omitted for a section with no page of its own. */
  to?: string;
}

/**
 * Trail of the pages above this one, ending in a chevron: the heading right
 * under the trail is the last step, so it is not repeated here.
 */
export default function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <Breadcrumb className="mb-2.5">
      <BreadcrumbList>
        {items.map((it, i) => (
          <BreadcrumbItem key={i}>
            {i > 0 && <BreadcrumbSeparator />}
            {it.to
              ? <BreadcrumbLink to={it.to}>{it.label}</BreadcrumbLink>
              : <span>{it.label}</span>}
          </BreadcrumbItem>
        ))}
        {/* Trailing chevron: the heading under the trail is the last step. */}
        <BreadcrumbSeparator />
      </BreadcrumbList>
    </Breadcrumb>
  );
}
