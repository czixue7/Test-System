export function normalizeText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    // 仅去除标点/空白，**保留数字**：
    // 数字（型号、温度、国标号等）是这类答案的唯一区分信息，
    // 曾经在这里 `.replace(/\d+/g, '')` 会把 RS232 与 RS485、7°C-21°C 与 7°C-22°C
    // 归一成同一串，导致答错也判满分。
    .replace(/[，。！？；：""''、,.!?;:"'、\-—…·～～《》【】（）()\[\]（）\s]/g, '')
    .trim();
}

export function calculateSimilarity(text1: string, text2: string): number {
  const normalized1 = normalizeText(text1);
  const normalized2 = normalizeText(text2);

  // 空值必须先判：否则两个「只剩标点」的答案都归一为空串，
  // 会因为 normalized1 === normalized2 而返回相似度 1（满分）。
  if (!normalized1 || !normalized2) return 0;
  if (normalized1 === normalized2) return 1;

  const distance = levenshteinDistance(normalized1, normalized2);
  const maxLength = Math.max(normalized1.length, normalized2.length);

  return Math.max(0, 1 - distance / maxLength);
}

/**
 * 统一主观题「正确性状态」判定：把 isCorrect 与得分绑定，
 * 保证 isCorrect === 2 当且仅当拿到满分。
 * 背景：原先相似度 ≥ 0.9 即记 isCorrect = 2，但得分可能是 round(maxScore * 0.95)，
 * 于是出现「标记全对但没满分」的自相矛盾记录，污染正确率统计。
 * @returns 2 = 正确（满分）, 1 = 部分正确（有得分）, 0 = 错误
 */
export function classifySubjective(
  score: number,
  maxScore: number
): 0 | 1 | 2 {
  if (maxScore > 0 && score >= maxScore) return 2;
  if (score > 0) return 1;
  return 0;
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
