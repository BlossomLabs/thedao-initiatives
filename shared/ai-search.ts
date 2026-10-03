/** Search relevance scores range from 0 to 1; Jev rubric scores are normalized to this range. */
export interface AiSearchResult {
  scores: { id: string; score: number }[];
  pickThreshold: number;
}

/** Recognize the short ZK topic while keeping accidental one/two-character queries out. */
export function isAiSearchQuery(query: string): boolean {
  const text = query.trim();
  return text.length >= 3 || /^zk$/i.test(text);
}
