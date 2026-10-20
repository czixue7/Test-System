import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas, DOMMatrix, ImageData } from 'canvas';
import Tesseract from 'tesseract.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(global as any).DOMMatrix = DOMMatrix;
(global as any).ImageData = ImageData;

pdfjsLib.GlobalWorkerOptions.workerSrc = '';

interface Question {
  id: string;
  week: number;
  type: 'choice' | 'judgment' | 'subjective';
  content: string;
  options?: string[];
  answer: string;
}

interface WeekData {
  week: number;
  title: string;
  questions: Question[];
}

const pdfDir = path.join(__dirname, '..', '文档');
const outputDir = path.join(__dirname, '..', 'src', 'data');

async function pdfToImages(pdfPath: string): Promise<Buffer[]> {
  const dataBuffer = fs.readFileSync(pdfPath);
  const uint8Array = new Uint8Array(dataBuffer);
  
  const pdfDoc = await pdfjsLib.getDocument({
    data: uint8Array,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;
  
  const images: Buffer[] = [];
  
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const scale = 2;
    const viewport = page.getViewport({ scale });
    
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');
    
    await page.render({
      canvasContext: context as any,
      viewport: viewport,
    }).promise;
    
    const imageBuffer = canvas.toBuffer('image/png');
    images.push(imageBuffer);
    console.log(`    转换第 ${pageNum} 页完成`);
  }
  
  return images;
}

async function ocrImages(images: Buffer[]): Promise<string> {
  let fullText = '';
  
  for (let i = 0; i < images.length; i++) {
    console.log(`    OCR识别第 ${i + 1}/${images.length} 页...`);
    process.stdout.write(`    进度: `);
    
    const result = await Tesseract.recognize(images[i], 'chi_sim+eng', {
      logger: m => {
        if (m.status === 'recognizing text') {
          process.stdout.write(`\r    进度: ${Math.round(m.progress * 100)}%`);
        }
      }
    });
    
    console.log('');
    fullText += result.data.text + '\n';
  }
  
  return fullText;
}

function extractQuestions(text: string, week: number): Question[] {
  const questions: Question[] = [];
  const lines = text.split('\n').map(line => line.trim()).filter(line => line);
  
  let currentQuestion: Partial<Question> | null = null;
  let questionIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    const questionMatch = line.match(/^(\d+)[.、．。]\s*(.+)/);
    if (questionMatch) {
      if (currentQuestion && currentQuestion.content) {
        questions.push(finalizeQuestion(currentQuestion, week, questionIndex));
        questionIndex++;
      }
      
      currentQuestion = {
        week,
        content: questionMatch[2],
        options: [],
      };
      continue;
    }

    const optionMatch = line.match(/^([A-Da-d])[.、．。)\s]\s*(.+)/);
    if (optionMatch && currentQuestion) {
      if (!currentQuestion.options) {
        currentQuestion.options = [];
      }
      currentQuestion.options.push(`${optionMatch[1].toUpperCase()}. ${optionMatch[2]}`);
      continue;
    }

    const answerMatch = line.match(/^(答案|正确答案)[：:]\s*(.+)/);
    if (answerMatch && currentQuestion) {
      currentQuestion.answer = answerMatch[2].trim();
      continue;
    }

    const bracketAnswerMatch = line.match(/[（(]\s*([答案：:]*\s*[A-Da-d正确错误]+)\s*[)）]/);
    if (bracketAnswerMatch && currentQuestion) {
      let answer = bracketAnswerMatch[1].replace(/答案[：:]/, '').trim();
      currentQuestion.answer = answer;
      continue;
    }

    if (currentQuestion && line.length > 0 && !line.match(/^[A-Da-d][.、．。]/)) {
      if (!currentQuestion.options || currentQuestion.options.length === 0) {
        currentQuestion.content = (currentQuestion.content || '') + line;
      }
    }
  }

  if (currentQuestion && currentQuestion.content) {
    questions.push(finalizeQuestion(currentQuestion, week, questionIndex));
  }

  return questions;
}

function finalizeQuestion(partial: Partial<Question>, week: number, index: number): Question {
  const content = partial.content || '';
  const options = partial.options;
  let answer = partial.answer || '';

  let type: 'choice' | 'judgment' | 'subjective' = 'subjective';
  
  if (options && options.length >= 2) {
    type = 'choice';
    if (answer && answer.length === 1 && /[A-Da-d]/.test(answer)) {
      answer = answer.toUpperCase();
    }
  } else if (answer === '正确' || answer === '错误' || 
             content.includes('判断') || content.includes('对错') ||
             content.includes('是否')) {
    type = 'judgment';
    if (!answer) {
      answer = '正确';
    }
  }

  return {
    id: `week${week}_q${index + 1}`,
    week,
    type,
    content: content.trim(),
    options: type === 'choice' ? options : undefined,
    answer: answer.trim(),
  };
}

async function parsePdf(filePath: string, week: number, weekName: string): Promise<Question[]> {
  console.log(`\n解析文件: ${path.basename(filePath)}`);
  
  try {
    console.log('  步骤1: 将PDF转换为图片...');
    
    const images = await pdfToImages(filePath);
    console.log(`  共转换 ${images.length} 页图片`);
    
    if (images.length === 0) {
      console.log('  转换失败，无法提取图片');
      return [];
    }
    
    console.log('  步骤2: OCR识别图片中的文字...');
    const text = await ocrImages(images);
    console.log(`  OCR识别完成，文本长度: ${text.length} 字符`);
    
    console.log('  步骤3: 解析题目...');
    const questions = extractQuestions(text, week);
    return questions;
  } catch (error) {
    console.error(`解析PDF失败: ${filePath}`, error);
    return [];
  }
}

async function main() {
  console.log('========================================');
  console.log('  PDF题库扫描导入工具');
  console.log('  支持扫描型PDF (OCR识别)');
  console.log('========================================\n');
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const weekNames = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const weekData: WeekData[] = [];
  let totalQuestions = 0;

  for (let week = 1; week <= 10; week++) {
    const fileName = `${week.toString().padStart(2, '0')}第${weekNames[week - 1]}周考题（答案）.pdf`;
    const filePath = path.join(pdfDir, fileName);
    
    if (fs.existsSync(filePath)) {
      const questions = await parsePdf(filePath, week, weekNames[week - 1]);
      weekData.push({
        week,
        title: `第${weekNames[week - 1]}周`,
        questions,
      });
      console.log(`  提取题目: ${questions.length} 道`);
      totalQuestions += questions.length;
    } else {
      console.log(`\n文件不存在: ${fileName}`);
      weekData.push({
        week,
        title: `第${weekNames[week - 1]}周`,
        questions: [],
      });
    }
  }

  const outputPath = path.join(outputDir, 'questions.json');
  fs.writeFileSync(outputPath, JSON.stringify(weekData, null, 2), 'utf-8');
  
  console.log('\n========================================');
  console.log(`  解析完成！`);
  console.log(`  数据已保存到: ${outputPath}`);
  console.log(`  总计: ${totalQuestions} 道题目`);
  console.log('========================================');
}

main().catch(console.error);
