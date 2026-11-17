/** API 키 없을 때 사용하는 로컬 LLM 데모 응답 (Tool 결과 기반) */

export interface DemoReplyInput {
  message: string;
  editionId?: number;
  articleId?: string;
  llmContext?: {
    toolsUsed?: string[];
    toolResults?: Record<string, unknown>;
  };
}

interface EditionStats {
  editionId?: number;
  total?: number;
  approved?: number;
  pending?: number;
  excluded?: number;
  approvalRate?: number;
  avgAiScore?: number;
  avgFinalScore?: number;
}

interface PendingArticle {
  id: string;
  subject: string;
  flagReason?: string;
  aiScore?: number;
}

interface SearchResult {
  query?: string;
  count?: number;
  articles?: { id: string; edition: number; subject: string; department?: string; status: string }[];
}

export function buildDemoLlmReply(input: DemoReplyInput): string {
  // 특정 호수(907)를 가정하지 않는다. 없으면 호수 표기를 생략.
  const editionId = input.editionId;
  const edLabel = editionId != null ? `${editionId}호 ` : "";
  const results = input.llmContext?.toolResults ?? {};
  const parts: string[] = [];

  const stats = results.get_edition_stats as EditionStats | undefined;
  const pending = results.get_pending_articles as { articles?: PendingArticle[] } | undefined;
  const duplicates = results.get_duplicate_pairs as { pairs?: { ids: string[]; subject: string }[] } | undefined;
  const article = results.get_article as { article?: { id: string; subject: string; status: string; aiScore: number; flagReason?: string; basis?: string } } | undefined;
  const person = results.get_person_articles as { name?: string; department?: string; articles?: { id: string; status: string }[] } | undefined;
  const editionStatus = results.get_edition_status as { edition?: { label: string; month: string; status: string; articleCount: number } } | undefined;
  const search = results.search_articles as SearchResult | undefined;

  // 호수 단위 요약이 필요한 질문일 때만 호수 맥락을 앞세운다.
  const editionScoped = !!(stats || (pending?.articles?.length) || (duplicates?.pairs?.length) || editionStatus);
  if (editionScoped && edLabel) {
    parts.push(`**${edLabel.trim()}** 기준으로 정리해 드릴게요.`);
  }

  if (stats && stats.total != null) {
    parts.push(
      `현재 **${stats.total}건** 중 승인 **${stats.approved ?? 0}건**, 재확인 **${stats.pending ?? 0}건**, 중복 제외 **${stats.excluded ?? 0}건**입니다. 승인률은 **${stats.approvalRate ?? 0}%**예요.`,
    );
    if (stats.avgAiScore != null) {
      parts.push(`AI 평균 점수는 **${stats.avgAiScore}점**, 확정 평균은 **${stats.avgFinalScore ?? "—"}점**입니다.`);
    }
  }

  // 목록형(미처리·검색·사원)은 아래 표가 상세를 담당하므로 텍스트는 건수만 요약한다.
  const pendingList = pending?.articles ?? [];
  if (pendingList.length > 0) {
    parts.push(`재확인이 필요한 기사는 **${pendingList.length}건**입니다.`);
  }

  const pairs = duplicates?.pairs ?? [];
  if (pairs.length > 0) {
    // 중복 응답은 표가 없어 텍스트가 쌍을 직접 보여준다.
    const dupLines = pairs.slice(0, 3).map(p => `• **${p.ids.join(" ↔ ")}** (${p.subject})`);
    const tail = pairs.length > 3 ? `\n…외 **${pairs.length - 3}쌍** 더 있어요.` : "";
    parts.push(`중복이 의심되는 쌍이 **${pairs.length}건** 있어요:\n${dupLines.join("\n")}${tail}`);
  }

  if (search?.query) {
    if ((search.count ?? 0) === 0) {
      parts.push(`**"${search.query}"** 로는 검색된 기사가 없어요. 실천자·부서·플래그 사유 같은 다른 키워드로 물어봐 주세요.`);
    } else {
      parts.push(`**"${search.query}"** 검색 결과는 **${search.count}건**입니다.`);
    }
  }

  if (article?.article) {
    const a = article.article;
    const detail = [
      a.flagReason ? `플래그 사유는 "${a.flagReason}"` : null,
      a.basis ? `근거: ${a.basis}` : null,
    ].filter(Boolean).join(", ");
    parts.push(
      `**${a.id}** (${a.subject}) 기사는 현재 상태 **${a.status}**, AI 점수 **${a.aiScore}점**입니다.${detail ? `\n${detail}.` : ""}`,
    );
  }

  if (person?.name && person.articles?.length) {
    parts.push(`**${person.name}** (${person.department ?? "—"}) 님과 관련된 기사는 **${person.articles.length}건**입니다.`);
  }

  if (editionStatus?.edition) {
    const e = editionStatus.edition;
    parts.push(`**${e.label}** (${e.month}) 는 현재 **${e.status}** 상태이고, 기사는 **${e.articleCount}건** 있습니다.`);
  }

  if (parts.length === 0) {
    return [
      `${edLabel}검수를 도와드릴게요.`,
      "예를 들어 **미처리 건수**, **중복 의심**, **승인률**, **1810** 같은 기사 ID, **실천자 이름**, 또는 \"○○ 찾아줘\" 같은 검색으로 물어봐 주세요.",
    ].join("\n\n");
  }

  // 표가 있을 때만 표를 가리킨다. 버튼은 있으면 눈에 보이므로 텍스트로 약속하지 않는다
  // (버튼이 없는 응답에서 "아래 버튼으로 이동" 같은 헛약속이 뜨지 않도록).
  const hasTableSection = pendingList.length > 0 || (search?.count ?? 0) > 0 || !!person?.articles?.length || !!article?.article;
  if (hasTableSection) {
    parts.push("자세한 내용은 아래 표에서 확인해 보세요.");
  }
  return parts.join("\n\n");
}
