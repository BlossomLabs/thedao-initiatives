/** Change only the category, retaining the board's query, filters, sort and layout. */
export function categoryBoardUrl(search: string, slug: string): string {
  const params = new URLSearchParams(search);
  params.set("cat", slug);
  return "/?" + params.toString();
}
