/** Search relevance scores range from 0 to 1; Jev rubric scores are normalized to this range. */
export interface AiSearchResult {
  scores: { id: string; score: number }[];
  pickThreshold: number;
}
