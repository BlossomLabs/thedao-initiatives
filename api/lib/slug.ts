export function slugify(title: string, max = 60): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, max).replace(/-+$/g, "") || "rfp";
}
