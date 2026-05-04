const { VertexAI } = require('@google-cloud/vertexai');
const csv = require('csvtojson');
const XLSX = require('xlsx');
const { GOOGLE_CLOUD_PROJECT, GEMINI_MODEL } = require('../../config/constants');

class ExtractorService {
  constructor() {
    this.vertexAI = new VertexAI({ project: GOOGLE_CLOUD_PROJECT, location: 'us-central1' });
    this.model = this.vertexAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: { responseMimeType: 'application/json' }
    });
  }

  /**
   * Processes a list of files as a single logical document.
   */
  async extractDocument(files, department, documentName) {
    let fullTextParts = [];

    for (const file of files) {
      console.log(`[Extractor] Processing: ${file.originalname} (${file.mimetype})`);
      const content = await this.extractFileContent(file);
      fullTextParts.push(content);
    }

    return {
      department,
      document_name: documentName,
      full_text: fullTextParts.join('\n\n---\n\n')
    };
  }

  async extractFileContent(file) {
    const mime = file.mimetype;
    const buffer = file.buffer;

    if (!buffer) {
        throw new Error(`Buffer missing for file: ${file.originalname}`);
    }

    // 1. PDF / Images (Vision-based extraction)
    if (mime === 'application/pdf' || mime.startsWith('image/')) {
      const data = buffer.toString('base64');
      const prompt = `Analyze this document. Extract all text into 'text_content' and tables into 'tables' (markdown). 
      Return JSON: { "text_content": "...", "tables": [{ "markdown": "..." }] }`;

      const result = await this.model.generateContent({
        contents: [{ 
          role: 'user', 
          parts: [{ inlineData: { data, mimeType: mime } }, { text: prompt }] 
        }],
      });

      const responseText = result.response.candidates[0].content.parts[0].text;
      const parsed = JSON.parse(responseText);
      
      let text = parsed.text_content || "";
      if (parsed.tables?.length) {
        text += "\n\n### Tables:\n" + parsed.tables.map(t => t.markdown).join('\n\n');
      }
      return text;
    }

    // 2. CSV
    if (mime.includes('csv')) {
      const jsonArray = await csv().fromString(buffer.toString('utf8'));
      return `[CSV Data]\n${JSON.stringify(jsonArray, null, 2)}`;
    }

    // 3. Excel
    if (mime.includes('spreadsheet') || mime.includes('excel')) {
      const workbook = XLSX.read(buffer);
      let excelContent = "";
      workbook.SheetNames.forEach(sheet => {
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheet]);
        excelContent += `[Sheet: ${sheet}]\n${JSON.stringify(data, null, 2)}\n`;
      });
      return excelContent;
    }

    // 4. Text Fallback
    return buffer.toString('utf8');
  }
}

module.exports = new ExtractorService();
