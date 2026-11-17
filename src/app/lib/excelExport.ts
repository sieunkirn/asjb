// exceljs는 무거워서(수백 KB) 다운로드 시점에만 동적 로딩한다
import type * as ExcelJSTypes from "exceljs";
import type { Article } from "../types";
import { DB_EXCEL_COLUMNS, articlesToDbRows } from "./dbExcelFormat";
import { DB_EXCEL_COLUMN_WIDTHS, DB_EXCEL_HEADER_FILL } from "./excelStyles";
import { saveBlob } from "./download";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function applyDbSheetStyle(sheet: ExcelJSTypes.Worksheet, rowCount: number) {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: DB_EXCEL_HEADER_FILL },
  };

  DB_EXCEL_COLUMN_WIDTHS.forEach((width, i) => {
    sheet.getColumn(i + 1).width = width;
  });

  for (let r = 2; r <= rowCount; r++) {
    sheet.getRow(r).alignment = { vertical: "top", wrapText: true };
  }
}

function triggerDownload(buffer: ArrayBuffer, filename: string) {
  saveBlob(new Blob([buffer], { type: XLSX_MIME }), filename);
}

/** 대시보드 기사 목록 → DB 시트 양식 Excel 다운로드 */
export async function exportArticlesToExcel(
  articles: Article[],
  _scope: string,
  editionLabel = "",
) {
  const rows = articlesToDbRows(articles);
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BREDRED Love Article Review";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("DB");
  sheet.addRow([...DB_EXCEL_COLUMNS]);
  for (const row of rows) {
    sheet.addRow(DB_EXCEL_COLUMNS.map(key => row[key] ?? ""));
  }
  applyDbSheetStyle(sheet, rows.length + 1);

  const buffer = await workbook.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 10);
  const label = editionLabel.replace(/\s/g, "") || "전체";
  triggerDownload(buffer, `DB_${label}_${stamp}.xlsx`);
}
