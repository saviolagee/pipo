export type MoodBand = 'high' | 'normal' | 'low' | 'veryLow';

/** Faixas de humor (seção 6.3). */
export function moodBand(mood: number): MoodBand {
  if (mood >= 80) return 'high';
  if (mood >= 40) return 'normal';
  if (mood >= 20) return 'low';
  return 'veryLow';
}
