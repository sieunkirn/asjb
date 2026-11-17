/** 브라우저에서 파일로 저장한다 (blob → 다운로드). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 클릭 직후에 주소를 해제하면 일부 브라우저에서 저장이 끊긴다
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
