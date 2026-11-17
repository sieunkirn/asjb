import { PageHeader } from "../components/ui/PageHeader";
import { ScoringSection } from "./ScoringPage";

/**
 * 파일 업로드 · AI 분석 · 채점 — 실제 분석 서버(SSD_Scoring) 연동 화면.
 * 업로드 → 기사 추출 → 실천자 점수화 흐름은 ScoringSection 이 담당한다.
 */
export function UploadPage() {
  return (
    <div className="flex-1 overflow-auto">
      <div className="page-container max-w-5xl">
        <PageHeader
          title="파일 업로드 · AI 분석 · 채점"
          description="한가족신문 PDF를 업로드하면 분석 서버가 ‘사랑의 챔피언’ 페이지를 찾아 기사를 추출하고, 실천자별 사랑평가 점수를 산정합니다. 1번·2번·기타내용 유형은 자동 확정하지 않고 기업 검토 대상으로 표시합니다."
        />
        <ScoringSection embedded />
      </div>
    </div>
  );
}
