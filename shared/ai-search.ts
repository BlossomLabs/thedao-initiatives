/** Search relevance scores range from 0 to 1 for either provider. */
export interface AiSearchResult {
  scores: { id: string; score: number }[];
  pickThreshold: number;
}
