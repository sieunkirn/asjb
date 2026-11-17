import { useState } from "react";
import { ChevronDown, ChevronRight, HelpCircle } from "lucide-react";
import { Card } from "./ui/Card";

/**
 * 점수 유형 안내 — 검수 화면 하단에서 "1번 유형", "4번 유형" 등이
 * 무슨 뜻인지 채점 기준(백엔드 score_prompt)과 동일한 내용으로 설명한다.
 */
export function ScoreTypeGuide() {
  const [open, setOpen] = useState(false);

  return (
    <Card padding="none" className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
      >
        <HelpCircle size={14} className="text-brand flex-shrink-0" />
        <span className="text-xs font-semibold text-foreground">점수 유형 안내 — “1번 유형”, “4번 유형”이 무슨 뜻인가요?</span>
        <span className="ml-auto text-muted-foreground">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-border text-xs leading-relaxed space-y-3">
          <div>
            <div className="font-semibold text-emerald-700 mb-1">자동 확정 — AI가 점수까지 확정하는 유형</div>
            <ul className="space-y-1 text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">4번 유형 (2점)</span> — 손수 만든 음식·선물 나눔 ·
                본인 소유 물품/과일·채소(직접 재배 포함) 나눔 · 한가족 프로젝트/자택 초대
                <span className="text-[11px]"> (사내부부 공동 초대는 각 1점)</span> ·
                고객의 직원 칭찬 사연 게재 · 시간·노력·비용이 특별히 큰 선행
              </li>
              <li>
                <span className="font-medium text-foreground">5번 유형 (1점)</span> — 사비로 산 5천 원 이상 선물 ·
                카풀/이동 도움 · 개인 물품 빌려줌 · 대가 없는 자발적 선행 · 사비로 식사 대접
              </li>
              <li>
                <span className="font-medium text-foreground">점수제외 (0점)</span> — 사적 관계의 일상적 예의 수준 ·
                회사 물품/탕비실 음료를 가져다 준 경우(사비 구매는 1점) · 개인 사비 결제자 없이 회비·경비로 진행된 모임 ·
                4개월 이상 지난 일(기사에 시점이 명시된 경우)
              </li>
            </ul>
          </div>

          <div>
            <div className="font-semibold text-amber-700 mb-1">기업 검토 필요 — 사람이 확인 후 확정하는 유형 (화면에는 “재확인”으로 표시)</div>
            <ul className="space-y-1 text-muted-foreground">
              <li>
                <span className="font-medium text-foreground">1번 유형 (확정 시 5점 후보)</span> — 1년 이상 근속한
                멘티가 추천한 의미 있는 멘토 활동 · 조직 갈등 중재/관계 회복/개선 사례
              </li>
              <li>
                <span className="font-medium text-foreground">2번 유형 (확정 시 4점 후보)</span> — 평가단 만장일치로
                추천된 감동 사례 · 심각한 위기/사고/큰 희생을 무릅쓴 실천
              </li>
              <li>
                <span className="font-medium text-foreground">기타내용 유형</span> — 사크리케어 3개월 이상 봉사 ·
                전년도 기부 · 본인 헌혈
              </li>
            </ul>
          </div>

          <p className="text-[11px] text-muted-foreground border-t border-border pt-2">
            최종 확정 점수는 <span className="font-mono font-semibold">0 · 1 · 2 · 4 · 5</span>점만 사용합니다.
            AI가 “후보”로 분류한 건은 검토 후 이 화면에서 점수를 확정해 주세요.
            내용이 같은 기사는 작성자가 달라도 1건만 반영합니다 (중복 건은 “중복 제외” 처리).
          </p>
        </div>
      )}
    </Card>
  );
}
