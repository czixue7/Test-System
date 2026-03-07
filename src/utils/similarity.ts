export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[，。！？；：""''、,.!?;:"'、\-—…·～～《》【】（）()\[\]（）\s]/g, '')
    .replace(/\d+/g, '')
    .trim();
}

export function calculateSimilarity(text1: string, text2: string): number {
  const normalized1 = normalizeText(text1);
  const normalized2 = normalizeText(text2);
  
  if (normalized1 === normalized2) return 1;
  if (!normalized1 || !normalized2) return 0;
  
  const distance = levenshteinDistance(normalized1, normalized2);
  const maxLength = Math.max(normalized1.length, normalized2.length);
  
  return Math.max(0, 1 - distance / maxLength);
}

function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + 1
        );
      }
    }
  }
  
  return dp[m][n];
}

export function calculateSubjectiveScore(
  userAnswer: string,
  correctAnswer: string,
  maxScore: number,
  threshold: number = 0.4
): { score: number; similarity: number } {
  const similarity = calculateSimilarity(userAnswer, correctAnswer);
  
  if (similarity >= 1) {
    return { score: maxScore, similarity: 1 };
  } else if (similarity >= threshold) {
    const score = Math.round(maxScore * similarity);
    return { score, similarity };
  } else {
    return { score: 0, similarity };
  }
}
