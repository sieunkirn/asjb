import { PageHeader } from "../components/ui/PageHeader";
import { PractitionerScorePanel } from "../components/PractitionerScorePanel";

/**
 * 실천자 점수 — 실천자별 사랑평가 점수 집계 화면
 * (예전 '사원 관리' 탭. 인사 명부 DB가 없어 사원 명단 기능은 제거했고,
 *  실제 DB의 확정 점수를 집계하는 이 화면만 남겼다.)
 */
export function PractitionerScorePage() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="page-container max-w-5xl">
        <PageHeader
          title="실천자 점수"
          description="실천자별 사랑평가 점수를 확인하고 엑셀로 내려받습니다"
        />
        <PractitionerScorePanel />
      </div>
    </div>
  );
}
