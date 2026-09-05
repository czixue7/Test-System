/**
 * 生成值班表 Excel 模板
 * 运行: npx tsx scripts/generate-duty-template.ts
 *
 * 模板包含两个工作表：
 *   1. 值班表：含表头与示例数据，列对应 JSON 字段
 *   2. 格式说明：字段含义、班次类型取值、任务填写方式
 */
import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM 下替代 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Test-System';
  workbook.created = new Date();

  // ===== 工作表 1: 值班表 =====
  const ws = workbook.addWorksheet('值班表', {
    views: [{ state: 'frozen', ySplit: 2 }]
  });

  // 列定义（与 JSON 字段一一对应）
  ws.columns = [
    { header: '', key: 'dummy', width: 2 }, // 占位列，用于合并标题
    { header: '日期', key: 'date', width: 14 },
    { header: '班次', key: 'shiftType', width: 10 },
    { header: '开始时间', key: 'startTime', width: 12 },
    { header: '结束时间', key: 'endTime', width: 12 },
    { header: '任务内容', key: 'tasks', width: 40 },
    { header: '负责人', key: 'personInCharge', width: 12 },
    { header: '备注', key: 'notes', width: 24 }
  ];

  // 第 1 行：标题（合并单元格）
  const titleRow = ws.getRow(1);
  titleRow.height = 26;
  ws.mergeCells(1, 1, 1, 8);
  const titleCell = ws.getCell('A1');
  titleCell.value = '值班表模板（修改后另存为 .xlsx 并通过导入功能上传）';
  titleCell.font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };

  // 第 2 行：表头
  const headerRow = ws.getRow(2);
  headerRow.height = 22;
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
  // 让所有列都有边框
  for (let col = 1; col <= 8; col++) {
    const cell = headerRow.getCell(col);
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFBFBFBF' } },
      bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } },
      left: { style: 'thin', color: { argb: 'FFBFBFBF' } },
      right: { style: 'thin', color: { argb: 'FFBFBFBF' } }
    };
  }

  // 示例数据（与 buildShifts 兼容：shiftType 支持英文与中文）
  const samples: Array<{
    date: string;
    shiftType: string;
    startTime: string;
    endTime: string;
    tasks: string;
    personInCharge: string;
    notes: string;
  }> = [
    {
      date: '2026-09-05',
      shiftType: '早班',
      startTime: '08:00',
      endTime: '14:00',
      tasks: '机房巡检\nUPS 电池电压记录\n空调运行状态检查',
      personInCharge: '张三',
      notes: '注意 B 区漏水告警'
    },
    {
      date: '2026-09-05',
      shiftType: '中班',
      startTime: '14:00',
      endTime: '20:00',
      tasks: '交接班确认\n消防设备检查',
      personInCharge: '李四',
      notes: ''
    },
    {
      date: '2026-09-05',
      shiftType: '晚班',
      startTime: '20:00',
      endTime: '08:00',
      tasks: '夜间巡检\n值班日志整理',
      personInCharge: '王五',
      notes: '次日 8:00 与早班交接'
    }
  ];

  // 写入示例数据（从第 3 行开始）
  samples.forEach((s, i) => {
    const row = ws.getRow(3 + i);
    row.getCell(2).value = s.date;
    row.getCell(3).value = s.shiftType;
    row.getCell(4).value = s.startTime;
    row.getCell(5).value = s.endTime;
    row.getCell(6).value = s.tasks;
    row.getCell(7).value = s.personInCharge;
    row.getCell(8).value = s.notes;
    row.alignment = { vertical: 'top', wrapText: true };
    row.height = 60;
    for (let col = 1; col <= 8; col++) {
      const cell = row.getCell(col);
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        right: { style: 'thin', color: { argb: 'FFD0D0D0' } }
      };
    }
  });

  // 数据有效性：班次类型下拉
  ws.dataValidations.add('C3:C1000', {
    type: 'list',
    allowBlank: true,
    formulae: ['"早班,中班,晚班,全天,morning,noon,night,allday"']
  });

  // ===== 工作表 2: 格式说明 =====
  const ws2 = workbook.addWorksheet('格式说明');
  ws2.columns = [
    { header: '字段', key: 'field', width: 16 },
    { header: 'JSON 对应', key: 'json', width: 18 },
    { header: '是否必填', key: 'required', width: 10 },
    { header: '说明', key: 'desc', width: 60 }
  ];

  const headerRow2 = ws2.getRow(1);
  headerRow2.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
  headerRow2.alignment = { vertical: 'middle', horizontal: 'center' };

  const docs = [
    { field: '日期', json: 'date', required: '是', desc: '格式 YYYY-MM-DD，例如 2026-09-05' },
    { field: '班次', json: 'shiftType', required: '是', desc: '可选值：早班/morning、中班/noon、晚班/night、全天/allday（中英文均可）' },
    { field: '开始时间', json: 'startTime', required: '否', desc: '格式 HH:mm，例如 08:00' },
    { field: '结束时间', json: 'endTime', required: '否', desc: '格式 HH:mm，例如 14:00' },
    { field: '任务内容', json: 'tasks', required: '否', desc: '多个任务请用换行（Alt+Enter）分隔，每行一条任务' },
    { field: '负责人', json: 'personInCharge', required: '否', desc: '该班次的负责人姓名' },
    { field: '备注', json: 'notes', required: '否', desc: '其他需要记录的事项' }
  ];

  docs.forEach((d, i) => {
    const row = ws2.getRow(2 + i);
    row.getCell(1).value = d.field;
    row.getCell(2).value = d.json;
    row.getCell(3).value = d.required;
    row.getCell(4).value = d.desc;
    row.alignment = { vertical: 'top', wrapText: true };
    for (let col = 1; col <= 4; col++) {
      const cell = row.getCell(col);
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        right: { style: 'thin', color: { argb: 'FFD0D0D0' } }
      };
    }
  });

  // 额外说明区
  const noteRowStart = 2 + docs.length + 1;
  const noteTitle = ws2.getRow(noteRowStart);
  noteTitle.getCell(1).value = '使用流程';
  noteTitle.getCell(1).font = { bold: true, size: 12 };
  ws2.mergeCells(noteRowStart, 1, noteRowStart, 4);

  const notes = [
    '1. 在「值班表」工作表中按行填写每个班次，删除示例数据后填入真实内容。',
    '2. 多个任务内容请用换行分隔（Excel 中按 Alt+Enter）。',
    '3. 填写完成后，将文件另存为 .xlsx 或保持 .xlsx 格式。',
    '4. 进入 App 的「值班表」页面 → 添加 → 选择 JSON 文件导入。',
    '5. Excel 模板仅供编辑参考；实际导入需要 JSON 文件。可使用脚本把 xlsx 转为 JSON 后导入。',
    '6. 班次类型支持中文（早班/中班/晚班/全天）和英文（morning/noon/night/allday）两种写法。'
  ];
  notes.forEach((n, i) => {
    const row = ws2.getRow(noteRowStart + 1 + i);
    row.getCell(1).value = n;
    ws2.mergeCells(noteRowStart + 1 + i, 1, noteRowStart + 1 + i, 4);
    row.alignment = { vertical: 'top', wrapText: true };
  });

  // 保存
  const outDir = path.resolve(__dirname, '..');
  const outPath = path.join(outDir, 'duty-schedule-template.xlsx');
  await workbook.xlsx.writeFile(outPath);
  console.log(`✅ Excel 模板已生成: ${outPath}`);
}

main().catch((err) => {
  console.error('生成失败:', err);
  process.exit(1);
});
