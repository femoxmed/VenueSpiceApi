import { Workbook } from 'exceljs';
import { exportTable, ExportReport } from './report-utils';
export async function reportXlsx(report: ExportReport) {
  const workbook = new Workbook();
  workbook.creator = 'Venue Spice';
  const sheet = workbook.addWorksheet('Analytics', { views: [{state:'frozen',ySplit:1}] });
  const { headers, rows } = exportTable(report);
  sheet.addRow(headers);
  // Strings remain string cells, never formulas; numeric metrics remain numeric.
  for (const row of rows) sheet.addRow(row.map(value => value == null ? null : typeof value === 'number' ? value : String(value)));
  sheet.getRow(1).font = {bold:true};
  sheet.columns.forEach(column => { column.width = 24; });
  sheet.autoFilter = { from: {row:1,column:1}, to: {row:1,column:headers.length} };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
